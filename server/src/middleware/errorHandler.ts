import type { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { AppError, ValidationError } from '../shared/errors/index.js';
import { logger } from '../logger.js';
import { config } from '../config/index.js';

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const requestId = (req as any).requestId as string | undefined;

  // Known operational errors
  if (err instanceof ValidationError) {
    res.status(err.statusCode).json({
      status: 'error',
      statusCode: err.statusCode,
      message: err.message,
      errors: err.errors,
      requestId,
    });
    return;
  }

  if (err instanceof AppError) {
    if (!err.isOperational) {
      logger.error({ err, requestId }, 'Unexpected operational error');
    }
    res.status(err.statusCode).json({
      status: 'error',
      statusCode: err.statusCode,
      message: err.message,
      requestId,
    });
    return;
  }

  // Prisma known errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = mapPrismaError(err);
    res.status(mapped.statusCode).json({
      status: 'error',
      statusCode: mapped.statusCode,
      message: mapped.message,
      requestId,
    });
    return;
  }

  // Unknown errors — log full details, return generic message
  logger.error({ err, requestId }, 'Unhandled error');
  res.status(500).json({
    status: 'error',
    statusCode: 500,
    message: config.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    requestId,
  });
}

function mapPrismaError(err: Prisma.PrismaClientKnownRequestError): { statusCode: number; message: string } {
  switch (err.code) {
    case 'P2002': {
      const fields = (err.meta?.target as string[]) ?? [];
      return { statusCode: 409, message: `A record with this ${fields.join(', ')} already exists` };
    }
    case 'P2025':
      return { statusCode: 404, message: 'Record not found' };
    case 'P2003':
      return { statusCode: 400, message: 'Related record not found' };
    default:
      return { statusCode: 500, message: 'Database error' };
  }
}
