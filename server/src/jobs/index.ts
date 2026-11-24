import type { Worker } from 'bullmq';
import { createEmailWorker } from './workers/email.worker.js';
import { createNotificationWorker } from './workers/notification.worker.js';
import { logger } from '../logger.js';

let emailWorker: Worker | null = null;
let notificationWorker: Worker | null = null;
let initialized = false;

/**
 * Start all BullMQ workers.
 * Called once from server.ts after Redis is connected.
 * Guards against duplicate initialization.
 */
export function startWorkers(): void {
  if (initialized) {
    logger.warn('BullMQ workers already initialized — skipping duplicate start');
    return;
  }

  emailWorker = createEmailWorker();
  notificationWorker = createNotificationWorker();
  initialized = true;

  logger.info('All BullMQ workers started');
}

/**
 * Gracefully close all BullMQ workers.
 * Called from server.ts during shutdown.
 */
export async function stopWorkers(): Promise<void> {
  const closePromises: Promise<void>[] = [];

  if (emailWorker) {
    closePromises.push(emailWorker.close());
  }
  if (notificationWorker) {
    closePromises.push(notificationWorker.close());
  }

  await Promise.allSettled(closePromises);
  initialized = false;

  logger.info('All BullMQ workers stopped');
}
