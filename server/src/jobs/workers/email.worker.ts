import { Worker, Job } from 'bullmq';
import { redis } from '../../config/redis.js';
import { emailProvider } from '../../email/index.js';
import { invitationEmail, passwordResetEmail } from '../../email/templates.js';
import { config } from '../../config/index.js';
import { logger } from '../../logger.js';
import type { SendInvitationEmailJob, SendPasswordResetEmailJob } from '../queues.js';

const childLogger = logger.child({ queue: 'email' });

/**
 * Email worker — processes invitation and password-reset emails.
 *
 * Runs in-process with the Express server (single Render Free service).
 * Uses the configured EmailProvider (Resend in production, console in dev).
 */
export function createEmailWorker(): Worker {
  const worker = new Worker(
    'email',
    async (job: Job) => {
      childLogger.info({ jobId: job.id, jobName: job.name }, 'Email job started');

      switch (job.name) {
        case 'send-invitation-email': {
          const data = job.data as SendInvitationEmailJob;
          const acceptUrl = `${config.APP_URL}/invitations/${data.rawToken}/accept`;
          const template = invitationEmail(data.orgName, data.inviterName, acceptUrl);
          await emailProvider.sendEmail({
            to: data.to,
            subject: template.subject,
            html: template.html,
          });
          childLogger.info({ jobId: job.id, to: data.to }, 'Invitation email sent');
          break;
        }

        case 'send-password-reset-email': {
          const data = job.data as SendPasswordResetEmailJob;
          const resetUrl = `${config.APP_URL}/reset-password?token=${data.rawToken}`;
          const template = passwordResetEmail(resetUrl);
          await emailProvider.sendEmail({
            to: data.to,
            subject: template.subject,
            html: template.html,
          });
          childLogger.info({ jobId: job.id, to: data.to }, 'Password reset email sent');
          break;
        }

        default:
          childLogger.warn({ jobId: job.id, jobName: job.name }, 'Unknown email job type — skipping');
      }
    },
    {
      connection: redis,
      concurrency: 3,
    },
  );

  worker.on('failed', (job, err) => {
    childLogger.error(
      { jobId: job?.id, jobName: job?.name, err: err.message, attempt: job?.attemptsMade },
      'Email job failed',
    );
  });

  worker.on('error', (err) => {
    childLogger.error({ err: err.message }, 'Email worker error');
  });

  childLogger.info('Email worker initialized');
  return worker;
}
