import { createServer } from 'node:http';
import app from './app.js';
import { config } from './config/index.js';
import { logger } from './logger.js';
import { prisma } from './config/database.js';
import { redis } from './config/redis.js';
import { closeSocketIO, initializeSocketIO } from './websocket/socket.js';
import { startWorkers, stopWorkers } from './jobs/index.js';

const httpServer = createServer(app);

/**
 * Brings the shared Redis client up exactly once.
 *
 * The BullMQ queues in `jobs/queues.ts` are constructed at import time and
 * BullMQ connects the client it is handed, so by the time `start()` runs the
 * lazy connection may already be in flight. Calling `connect()` again in that
 * state makes ioredis throw.
 */
async function ensureRedisConnected(): Promise<void> {
  if (redis.status === 'ready') return;

  if (redis.status === 'wait') {
    await redis.connect();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      redis.off('ready', onReady);
      redis.off('error', onError);
    };
    const onReady = (): void => {
      cleanup();
      resolve();
    };
    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };
    redis.once('ready', onReady);
    redis.once('error', onError);
  });
}

// Initialize Socket.IO
initializeSocketIO(httpServer);

async function start(): Promise<void> {
  try {
    // Connect to PostgreSQL
    await prisma.$connect();
    logger.info('PostgreSQL connected');

    // Connect to Redis
    await ensureRedisConnected();

    // Start BullMQ workers (in-process, single Render Free service)
    startWorkers();

    httpServer.listen(config.PORT, '0.0.0.0', () => {
      logger.info({ port: config.PORT, env: config.NODE_ENV }, `SprintNest server running on port ${config.PORT}`);
    });
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown(): Promise<void> {
  logger.info('Shutting down...');
  // Close Socket.IO first: it disconnects clients and releases its handle on
  // the HTTP server, so the server can finish closing.
  await closeSocketIO();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await stopWorkers();
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (err) => {
  logger.fatal({ err }, 'Unhandled rejection');
  process.exit(1);
});

start();
