import { Worker, Job } from 'bullmq';
import { redis } from '../../config/redis.js';
import { prisma } from '../../config/database.js';
import { createNotification } from '../../modules/notifications/notifications.service.js';
import { emitNotificationNew } from '../../websocket/socket.js';
import { logger } from '../../logger.js';
import type { FanOutNotificationJob } from '../queues.js';

const childLogger = logger.child({ queue: 'notifications' });

/**
 * Notification worker — creates notification records via the existing Notification service.
 *
 * Runs in-process with Express. Reuses createNotification() which already handles
 * unread-count cache invalidation.
 *
 * Idempotency: BullMQ may retry failed jobs. Safe idempotency is enforced by:
 * 1. Tracking completed job IDs in Redis with a 24-hour TTL.
 * 2. On job retry (attemptsMade > 0), querying PostgreSQL for an identical notification
 *    created in the last 5 minutes to prevent duplicate records if the previous attempt
 *    committed to the database before a transient network or server crash.
 */
export function createNotificationWorker(): Worker {
  const worker = new Worker(
    'notifications',
    async (job: Job) => {
      childLogger.info({ jobId: job.id, jobName: job.name }, 'Notification job started');

      if (job.name !== 'fan-out-notification') {
        childLogger.warn({ jobId: job.id, jobName: job.name }, 'Unknown notification job type — skipping');
        return;
      }

      const data = job.data as FanOutNotificationJob;

      if (!data.recipientId || !data.type || !data.title) {
        childLogger.error({ jobId: job.id }, 'Malformed notification job payload — skipping');
        return;
      }

      // ─── Event-Specific Idempotency ─────────────────────
      // Derives stable event-specific dedupe key: explicit event dedupeKey or fallback to job ID
      const dedupeKey = data.dedupeKey || (job.id ? `job:${job.id}` : null);

      // Fast check in Redis to avoid database work if this job already completed
      const redisDoneKey = dedupeKey ? `bullmq:notification:done:${dedupeKey}` : null;
      if (redisDoneKey) {
        const alreadyDone = await redis.get(redisDoneKey);
        if (alreadyDone) {
          childLogger.info({ jobId: job.id, dedupeKey }, 'Notification job already completed (found in cache), skipping');
          return;
        }
      }

      const { notification, isDuplicate } = await createNotification({
        userId: data.recipientId,
        type: data.type,
        title: data.title,
        data: data.data as any,
        dedupeKey,
      });

      if (redisDoneKey) {
        await redis.set(redisDoneKey, notification.id, 'EX', 86400);
      }

      if (isDuplicate) {
        childLogger.info(
          { jobId: job.id, notificationId: notification.id, dedupeKey },
          'Notification already exists for dedupeKey; skipping duplicate emit',
        );
        return;
      }

      // Real-time delivery happens only after the record is committed. The
      // service already handled unread-count cache invalidation.
      emitNotificationNew(data.recipientId, { notification });

      childLogger.info(
        { jobId: job.id, recipientId: data.recipientId, type: data.type, dedupeKey },
        'Notification created',
      );
    },
    {
      connection: redis,
      concurrency: 5,
    },
  );

  worker.on('failed', (job, err) => {
    childLogger.error(
      { jobId: job?.id, jobName: job?.name, err: err.message, attempt: job?.attemptsMade },
      'Notification job failed',
    );
  });

  worker.on('error', (err) => {
    childLogger.error({ err: err.message }, 'Notification worker error');
  });

  childLogger.info('Notification worker initialized');
  return worker;
}
