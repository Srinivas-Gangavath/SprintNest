import { PrismaClient } from '@prisma/client';
import { config } from './index.js';

export const prisma = new PrismaClient({
  datasourceUrl: config.DATABASE_URL,
  log: config.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
