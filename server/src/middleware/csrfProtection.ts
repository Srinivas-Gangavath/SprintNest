import type { Request, Response, NextFunction } from 'express';
import { CSRF_HEADER } from '../shared/constants.js';

/**
 * CSRF protection for state-changing requests (POST, PUT, PATCH, DELETE).
 * Requires the custom header `X-Requested-With: XMLHttpRequest`.
 * SameSite=Lax cookies already block cross-origin form POSTs; this is defense-in-depth.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    next();
    return;
  }

  const headerValue = req.headers[CSRF_HEADER];
  if (!headerValue) {
    res.status(403).json({
      status: 'error',
      statusCode: 403,
      message: 'Missing CSRF header',
      requestId: (req as any).requestId,
    });
    return;
  }

  next();
}
