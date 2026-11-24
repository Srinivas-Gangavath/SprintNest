import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthenticationError } from '../shared/errors/index.js';
import { ACCESS_TOKEN_COOKIE } from '../shared/constants.js';
import { verifyAccessToken } from '../modules/auth/auth.service.js';
import type { AuthenticatedRequest } from '../shared/types/index.js';

/**
 * Verifies the JWT access token from the httpOnly cookie.
 * Attaches `req.user` on success, throws 401 on failure.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  try {
    const token = req.cookies?.[ACCESS_TOKEN_COOKIE];

    if (!token) {
      throw new AuthenticationError('Authentication required');
    }

    (req as AuthenticatedRequest).user = verifyAccessToken(token);

    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      next(new AuthenticationError('Access token expired'));
      return;
    }
    if (err instanceof jwt.JsonWebTokenError) {
      next(new AuthenticationError('Invalid access token'));
      return;
    }
    next(err);
  }
}
