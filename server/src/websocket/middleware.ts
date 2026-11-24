import jwt from 'jsonwebtoken';
import { ACCESS_TOKEN_COOKIE } from '../shared/constants.js';
import { verifyAccessToken } from '../modules/auth/auth.service.js';
import { logger } from '../logger.js';
import { SOCKET_AUTH_ERRORS } from './events.js';
import type { AppSocket } from './socket.js';

/**
 * Minimal cookie header parser. Socket.IO handshakes bypass the Express
 * middleware stack, so `cookie-parser` has not run by this point.
 */
function parseCookieHeader(header: string | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  if (!header) return jar;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name && !(name in jar)) {
      jar[name] = decodeURIComponent(value);
    }
  }

  return jar;
}

/**
 * Authenticates a Socket.IO handshake using the same `access_token` httpOnly
 * cookie the REST API uses. Identity always comes from the verified JWT — the
 * client never supplies a user ID.
 */
export function authenticateSocket(
  socket: AppSocket,
  next: (err?: Error) => void,
): void {
  const cookies = parseCookieHeader(socket.handshake.headers.cookie);
  const token = cookies[ACCESS_TOKEN_COOKIE];

  if (!token) {
    logger.debug({ socketId: socket.id }, 'Socket auth rejected: no access token cookie');
    next(new Error(SOCKET_AUTH_ERRORS.UNAUTHENTICATED));
    return;
  }

  try {
    const user = verifyAccessToken(token);
    socket.data.userId = user.id;
    socket.data.email = user.email;
    next();
  } catch (err) {
    const reason =
      err instanceof jwt.TokenExpiredError
        ? SOCKET_AUTH_ERRORS.TOKEN_EXPIRED
        : SOCKET_AUTH_ERRORS.INVALID_TOKEN;

    // Never log the token itself.
    logger.debug({ socketId: socket.id, reason }, 'Socket authentication rejected');
    next(new Error(reason));
  }
}
