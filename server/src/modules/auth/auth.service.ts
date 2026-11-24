import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../config/database.js';
import { config } from '../../config/index.js';
import { generateToken, hashToken } from '../../shared/utils/hash.js';
import { AuthenticationError, ConflictError, NotFoundError, AppError } from '../../shared/errors/index.js';
import { emailQueue } from '../../jobs/queues.js';
import { PASSWORD_RESET_TTL_HOURS } from '../../shared/constants.js';
import type { AuthUser } from '../../shared/types/index.js';
import { logger } from '../../logger.js';

const BCRYPT_ROUNDS = 12;

/** Safe user object — never includes passwordHash */
function sanitizeUser(user: { id: string; email: string; displayName: string; avatarUrl: string | null; createdAt: Date }) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
  };
}

// ─── Registration ───────────────────────────────────────

export async function registerUser(data: { email: string; password: string; displayName: string }) {
  const email = data.email.toLowerCase().trim();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new ConflictError('An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      displayName: data.displayName.trim(),
    },
  });

  return sanitizeUser(user);
}

// ─── Login ──────────────────────────────────────────────

export async function loginUser(email: string, password: string) {
  const normalizedEmail = email.toLowerCase().trim();

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) {
    throw new AuthenticationError('Invalid email or password');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new AuthenticationError('Invalid email or password');
  }

  return sanitizeUser(user);
}

// ─── JWT Tokens ─────────────────────────────────────────

export function generateAccessToken(user: { id: string; email: string }): string {
  return jwt.sign(
    { sub: user.id, email: user.email },
    config.JWT_SECRET,
    { expiresIn: config.JWT_ACCESS_EXPIRY as any },
  );
}

/**
 * Verifies an access token and returns the authenticated user context.
 * Throws the underlying `jsonwebtoken` error so callers can distinguish
 * expiry from tampering. Shared by the HTTP `authenticate` middleware and
 * the Socket.IO handshake middleware so there is one verification path.
 */
export function verifyAccessToken(token: string): AuthUser {
  const payload = jwt.verify(token, config.JWT_SECRET) as jwt.JwtPayload;
  return {
    id: payload.sub as string,
    email: payload.email as string,
  };
}

export async function createRefreshToken(userId: string): Promise<string> {
  const rawToken = generateToken(32);
  const tokenHash = hashToken(rawToken);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + config.JWT_REFRESH_EXPIRY_DAYS);

  await prisma.refreshToken.create({
    data: { userId, tokenHash, expiresAt },
  });

  return rawToken;
}

export async function rotateRefreshToken(presentedToken: string) {
  const tokenHash = hashToken(presentedToken);

  const storedToken = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!storedToken) {
    // Possible token reuse attack — revoke all tokens for any user that previously had this token
    // We can't identify the user from a missing hash, so just reject.
    // If we detect reuse (token found but already deleted), we'd revoke all. Since BullMQ cleanup
    // is lazy, the token simply won't exist if it was already rotated.
    throw new AuthenticationError('Invalid refresh token');
  }

  if (storedToken.expiresAt < new Date()) {
    // Lazy expiration: delete the expired token
    await prisma.refreshToken.delete({ where: { id: storedToken.id } });
    throw new AuthenticationError('Refresh token expired');
  }

  // Delete the used token (rotation)
  await prisma.refreshToken.delete({ where: { id: storedToken.id } });

  // Fetch user
  const user = await prisma.user.findUnique({ where: { id: storedToken.userId } });
  if (!user) {
    throw new AuthenticationError('User not found');
  }

  // Issue new tokens
  const accessToken = generateAccessToken(user);
  const newRefreshToken = await createRefreshToken(user.id);

  return { user: sanitizeUser(user), accessToken, refreshToken: newRefreshToken };
}

// ─── Logout ─────────────────────────────────────────────

export async function revokeRefreshToken(presentedToken: string): Promise<void> {
  const tokenHash = hashToken(presentedToken);
  // Delete if exists; ignore if already gone
  await prisma.refreshToken.deleteMany({ where: { tokenHash } });
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { userId } });
}

// ─── Forgot Password ───────────────────────────────────

export async function forgotPassword(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  // Always return success to avoid email enumeration
  if (!user) {
    logger.info({ email: normalizedEmail }, 'Password reset requested for non-existent email');
    return;
  }

  // Invalidate prior unused tokens for this user
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const rawToken = generateToken(32);
  const tokenHash = hashToken(rawToken);

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + PASSWORD_RESET_TTL_HOURS);

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });

  // Enqueue password reset email via BullMQ
  // Note: rawToken is included in the job payload so the worker can construct the reset URL.
  // It is never logged. If queue submission fails, we log the failure but still return
  // a generic response to avoid user enumeration. The reset token exists in the DB so
  // the user could request another reset if the email was never sent.
  try {
    await emailQueue.add('send-password-reset-email', {
      to: user.email,
      rawToken,
    });
  } catch (err) {
    logger.error({ err, userId: user.id }, 'Failed to enqueue password reset email job');
  }
}

// ─── Reset Password ────────────────────────────────────

export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const tokenHash = hashToken(rawToken);

  const storedToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!storedToken) {
    throw new AppError('Invalid or expired reset token', 400);
  }

  if (storedToken.usedAt) {
    throw new AppError('This reset token has already been used', 400);
  }

  if (storedToken.expiresAt < new Date()) {
    // Lazy expiration
    await prisma.passwordResetToken.update({
      where: { id: storedToken.id },
      data: { usedAt: new Date() },
    });
    throw new AppError('Reset token has expired', 400);
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  // Update password, mark token used, and revoke all refresh tokens in one transaction
  await prisma.$transaction([
    prisma.user.update({
      where: { id: storedToken.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: storedToken.id },
      data: { usedAt: new Date() },
    }),
    prisma.refreshToken.deleteMany({
      where: { userId: storedToken.userId },
    }),
  ]);
}

// ─── Get Current User ──────────────────────────────────

export async function getCurrentUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('User');
  return sanitizeUser(user);
}

// ─── Update Profile ────────────────────────────────────

export async function updateProfile(userId: string, data: { displayName?: string; avatarUrl?: string | null }) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(data.displayName !== undefined && { displayName: data.displayName.trim() }),
      ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
    },
  });
  return sanitizeUser(user);
}
