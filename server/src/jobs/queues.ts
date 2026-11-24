import { Queue } from 'bullmq';
import { redis } from '../config/redis.js';
import { logger } from '../logger.js';

/**
 * BullMQ queues — reuse the existing ioredis connection.
 *
 * Two queues per the implementation plan:
 * - email:         send-invitation-email, send-password-reset-email
 * - notifications: fan-out-notification
 *
 * Keep completed/failed job history small for Upstash Free daily command limits.
 */

export const emailQueue = new Queue('email', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  },
});

export const notificationQueue = new Queue('notifications', {
  connection: redis,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  },
});

logger.info('BullMQ queues initialized (email, notifications)');

// ─── Job payload types ──────────────────────────────────

export interface SendInvitationEmailJob {
  to: string;
  orgName: string;
  inviterName: string;
  rawToken: string; // needed to construct accept URL — never logged
}

export interface SendPasswordResetEmailJob {
  to: string;
  rawToken: string; // needed to construct reset URL — never logged
}

export interface FanOutNotificationJob {
  type: 'task_assigned' | 'comment_added' | 'invitation_received';
  recipientId: string;
  title: string;
  data: Record<string, unknown>;
  dedupeKey?: string;
}
