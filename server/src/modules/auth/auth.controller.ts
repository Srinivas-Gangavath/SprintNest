import type { Request, Response, NextFunction } from 'express';
import { config, isProduction } from '../../config/index.js';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '../../shared/constants.js';
import type { AuthenticatedRequest } from '../../shared/types/index.js';
import * as authService from './auth.service.js';

// ─── Cookie helpers ─────────────────────────────────────

const accessCookieBase = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax' as const,
  path: '/',
};

const refreshCookieBase = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax' as const,
  path: '/api/v1/auth/refresh',
};

function setAccessTokenCookie(res: Response, token: string): void {
  res.cookie(ACCESS_TOKEN_COOKIE, token, {
    ...accessCookieBase,
    maxAge: 15 * 60 * 1000, // 15 minutes
  });
}

function setRefreshTokenCookie(res: Response, token: string): void {
  res.cookie(REFRESH_TOKEN_COOKIE, token, {
    ...refreshCookieBase,
    maxAge: config.JWT_REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  });
}

/** Issues the same access and refresh cookies used by register and login. */
export async function establishSession(res: Response, user: { id: string; email: string }): Promise<void> {
  const accessToken = authService.generateAccessToken(user);
  const refreshToken = await authService.createRefreshToken(user.id);
  setAccessTokenCookie(res, accessToken);
  setRefreshTokenCookie(res, refreshToken);
}

function clearAuthCookies(res: Response): void {
  // Path/Secure/SameSite must match the original Set-Cookie or browsers keep the cookie.
  res.clearCookie(ACCESS_TOKEN_COOKIE, accessCookieBase);
  res.clearCookie(REFRESH_TOKEN_COOKIE, refreshCookieBase);
}

// ─── Controllers ────────────────────────────────────────

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await authService.registerUser(req.body);
    await establishSession(res, user);

    res.status(201).json({ status: 'success', data: { user } });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await authService.loginUser(req.body.email, req.body.password);
    await establishSession(res, user);

    res.json({ status: 'success', data: { user } });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const presentedToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (!presentedToken) {
      res.status(401).json({ status: 'error', statusCode: 401, message: 'No refresh token provided' });
      return;
    }

    const result = await authService.rotateRefreshToken(presentedToken);

    setAccessTokenCookie(res, result.accessToken);
    setRefreshTokenCookie(res, result.refreshToken);

    res.json({ status: 'success', data: { user: result.user } });
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const presentedToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (presentedToken) {
      await authService.revokeRefreshToken(presentedToken);
    }
    clearAuthCookies(res);
    res.json({ status: 'success', data: null });
  } catch (err) {
    next(err);
  }
}

export async function forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await authService.forgotPassword(req.body.email);
    // Always return success to prevent email enumeration
    res.json({ status: 'success', data: { message: 'If that email exists, a reset link has been sent' } });
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await authService.resetPassword(req.body.token, req.body.password);
    clearAuthCookies(res);
    res.json({ status: 'success', data: { message: 'Password has been reset. Please log in.' } });
  } catch (err) {
    next(err);
  }
}

export async function getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authReq = req as AuthenticatedRequest;
    const user = await authService.getCurrentUser(authReq.user.id);
    res.json({ status: 'success', data: { user } });
  } catch (err) {
    next(err);
  }
}

export async function updateMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authReq = req as AuthenticatedRequest;
    const user = await authService.updateProfile(authReq.user.id, req.body);
    res.json({ status: 'success', data: { user } });
  } catch (err) {
    next(err);
  }
}
