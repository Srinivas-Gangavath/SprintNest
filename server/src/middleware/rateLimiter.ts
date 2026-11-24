import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';

/** Strict rate limiter for auth endpoints — prevents brute force */
export const authRateLimiter = process.env.NODE_ENV === 'test'
  ? (_req: Request, _res: Response, next: NextFunction) => next()
  : rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      limit: 20, // max 20 requests per window per IP
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: {
        status: 'error',
        statusCode: 429,
        message: 'Too many requests, please try again later',
      },
    });
