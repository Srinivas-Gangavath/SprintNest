import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { cleanDatabase, testPrisma } from '../helpers/db.js';
import { emailQueue, notificationQueue } from '../../src/jobs/queues.js';
import { startWorkers, stopWorkers } from '../../src/jobs/index.js';
import { createEmailWorker } from '../../src/jobs/workers/email.worker.js';
import { createNotificationWorker } from '../../src/jobs/workers/notification.worker.js';
import { passwordResetEmail, invitationEmail } from '../../src/email/templates/index.js';
import { ConsoleEmailProvider } from '../../src/email/console.provider.js';
import { ResendEmailProvider } from '../../src/email/resend.provider.js';
import { createEmailProvider, emailProvider } from '../../src/email/index.js';
import { createTask, updateTask } from '../../src/modules/tasks/tasks.service.js';
import { createComment } from '../../src/modules/comments/comments.service.js';
import { inviteMember } from '../../src/modules/members/members.service.js';
import { forgotPassword } from '../../src/modules/auth/auth.service.js';
import { config } from '../../src/config/index.js';
import Redis from 'ioredis';

const testRedis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  lazyConnect: true,
});

async function waitForCondition(
  predicate: () => Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 50,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
}

beforeAll(async () => {
  await testRedis.connect();
  try {
    await emailQueue.drain();
    await notificationQueue.drain();
  } catch {}
});

afterAll(async () => {
  await stopWorkers();
  try {
    await emailQueue.close();
    await notificationQueue.close();
  } catch {}
  await testRedis.quit();
});

describe('Phase 10 — BullMQ & Transactional Email', () => {
  beforeEach(async () => {
    await cleanDatabase();
    try {
      await emailQueue.drain();
      await notificationQueue.drain();
    } catch {}
  });

  // ─── 1. EMAIL TEMPLATES (UNIT) ───────────────────────────

  describe('Email Templates', () => {
    it('should generate password reset email with correct subject, URL, and expiration', () => {
      const resetUrl = 'http://localhost:3000/reset-password?token=abc123secret';
      const template = passwordResetEmail(resetUrl);

      expect(template.subject).toBe('SprintNest — Reset Your Password');
      expect(template.html).toContain(resetUrl);
      expect(template.html).toContain('1 hour');
      expect(template.html).toContain('Reset Password');
      expect(template.html).toContain('ignore this email');
    });

    it('should generate organization invitation email with org, inviter, and accept URL', () => {
      const acceptUrl = 'http://localhost:3000/invitations/rawtoken123/accept';
      const template = invitationEmail('Acme Corp', 'Alice Smith', acceptUrl);

      expect(template.subject).toBe("SprintNest — You've been invited to join Acme Corp");
      expect(template.html).toContain('Acme Corp');
      expect(template.html).toContain('Alice Smith');
      expect(template.html).toContain(acceptUrl);
      expect(template.html).toContain('7 days');
      expect(template.html).toContain('Accept Invitation');
    });
  });

  // ─── 2. EMAIL PROVIDERS (UNIT) ───────────────────────────

  describe('Email Providers', () => {
    it('ConsoleEmailProvider should log without error', async () => {
      const provider = new ConsoleEmailProvider();
      await expect(
        provider.sendEmail({
          to: 'user@example.com',
          subject: 'Test Subject',
          html: '<p>Test Body</p>',
        }),
      ).resolves.not.toThrow();
    });

    it('createEmailProvider factory should return ConsoleEmailProvider when configured for console', () => {
      const provider = createEmailProvider();
      expect(provider).toBeInstanceOf(ConsoleEmailProvider);
    });

    it('ResendEmailProvider should throw error if RESEND_API_KEY is not configured', () => {
      const origKey = config.RESEND_API_KEY;
      (config as any).RESEND_API_KEY = undefined;

      try {
        expect(() => new ResendEmailProvider()).toThrow('RESEND_API_KEY is required');
      } finally {
        (config as any).RESEND_API_KEY = origKey;
      }
    });
  });

  // ─── 3. QUEUE CONFIGURATION ──────────────────────────────

  describe('Queue Configurations & Retry Policies', () => {
    it('emailQueue has 3 attempts, exponential backoff, and retention limits', () => {
      const opts = emailQueue.defaultJobOptions;
      expect(opts.attempts).toBe(3);
      expect(opts.backoff).toEqual({ type: 'exponential', delay: 2000 });
      expect(opts.removeOnComplete).toEqual({ count: 50 });
      expect(opts.removeOnFail).toEqual({ count: 100 });
    });

    it('notificationQueue has 2 attempts, exponential backoff, and retention limits', () => {
      const opts = notificationQueue.defaultJobOptions;
      expect(opts.attempts).toBe(2);
      expect(opts.backoff).toEqual({ type: 'exponential', delay: 1000 });
      expect(opts.removeOnComplete).toEqual({ count: 50 });
      expect(opts.removeOnFail).toEqual({ count: 100 });
    });
  });

  // ─── 4. WORKER LIFECYCLE ─────────────────────────────────

  describe('Worker Lifecycle Manager', () => {
    it('startWorkers should initialize workers without crashing', () => {
      expect(() => startWorkers()).not.toThrow();
    });

    it('startWorkers should be idempotent and guard against duplicate start', () => {
      expect(() => startWorkers()).not.toThrow();
      expect(() => startWorkers()).not.toThrow();
    });

    it('stopWorkers should shut down gracefully', async () => {
      await expect(stopWorkers()).resolves.not.toThrow();
    });
  });

  // ─── 5. EMAIL WORKER PROCESSING ──────────────────────────

  describe('Email Worker Processing', () => {
    let worker: ReturnType<typeof createEmailWorker>;

    beforeEach(() => {
      worker = createEmailWorker();
    });

    afterEach(async () => {
      await worker.close();
    });

    it('processes send-invitation-email job successfully', async () => {
      let sentTo = '';
      let sentSubject = '';
      const sendEmailSpy = vi.spyOn(emailProvider, 'sendEmail').mockImplementation(async (opts) => {
        sentTo = opts.to;
        sentSubject = opts.subject;
      });

      await emailQueue.add('send-invitation-email', {
        to: 'invitee@example.com',
        orgName: 'Alpha Team',
        inviterName: 'Bob Builder',
        rawToken: 'secureToken999',
      });

      await waitForCondition(async () => sentTo === 'invitee@example.com');

      expect(sentSubject).toContain('Alpha Team');
      sendEmailSpy.mockRestore();
    });

    it('processes send-password-reset-email job successfully', async () => {
      let sentTo = '';
      let sentSubject = '';
      const sendEmailSpy = vi.spyOn(emailProvider, 'sendEmail').mockImplementation(async (opts) => {
        sentTo = opts.to;
        sentSubject = opts.subject;
      });

      await emailQueue.add('send-password-reset-email', {
        to: 'resetme@example.com',
        rawToken: 'resetTokenXYZ',
      });

      await waitForCondition(async () => sentTo === 'resetme@example.com');

      expect(sentSubject).toBe('SprintNest — Reset Your Password');
      sendEmailSpy.mockRestore();
    });
  });

  // ─── 6. NOTIFICATION WORKER PROCESSING ───────────────────

  describe('Notification Worker Processing', () => {
    let worker: ReturnType<typeof createNotificationWorker>;

    beforeEach(() => {
      worker = createNotificationWorker();
    });

    afterEach(async () => {
      await worker.close();
    });

    it('processes fan-out-notification job and creates database record', async () => {
      const user = await testPrisma.user.create({
        data: {
          email: 'recipient@test.com',
          passwordHash: 'hashed',
          displayName: 'Recipient User',
        },
      });

      await notificationQueue.add('fan-out-notification', {
        type: 'task_assigned',
        recipientId: user.id,
        title: 'You were assigned to "Fix Login Bug"',
        data: { taskId: 'task-1', taskTitle: 'Fix Login Bug' },
      });

      await waitForCondition(async () => {
        const count = await testPrisma.notification.count({ where: { userId: user.id } });
        return count > 0;
      });

      const notifications = await testPrisma.notification.findMany({
        where: { userId: user.id },
      });

      expect(notifications.length).toBe(1);
      expect(notifications[0].type).toBe('task_assigned');
      expect(notifications[0].title).toBe('You were assigned to "Fix Login Bug"');
      expect(notifications[0].isRead).toBe(false);
      expect(notifications[0].data).toEqual({ taskId: 'task-1', taskTitle: 'Fix Login Bug' });
    });

    it('idempotency: same job retried produces only one notification record', async () => {
      const user = await testPrisma.user.create({
        data: {
          email: 'retry-worker@test.com',
          passwordHash: 'hash',
          displayName: 'Retry User',
        },
      });

      const payload = {
        type: 'task_assigned' as const,
        recipientId: user.id,
        title: 'You were assigned to "Retry Task"',
        dedupeKey: `task_assigned:task-idem-1:${user.id}`,
        data: { taskId: 'task-idem-1', taskTitle: 'Retry Task' },
      };

      await notificationQueue.add('fan-out-notification', payload);

      await waitForCondition(async () => {
        const count = await testPrisma.notification.count({ where: { userId: user.id } });
        return count === 1;
      });

      // Retried job with the same dedupeKey
      await notificationQueue.add('fan-out-notification', payload);
      await new Promise((r) => setTimeout(r, 200));

      const countAfter = await testPrisma.notification.count({ where: { userId: user.id } });
      expect(countAfter).toBe(1);
    });

    it('idempotency: worker crashes after DB insertion — retry does not duplicate the record', async () => {
      const user = await testPrisma.user.create({
        data: {
          email: 'crash-worker@test.com',
          passwordHash: 'hash',
          displayName: 'Crash Test User',
        },
      });

      const dedupeKey = `task_assigned:crashed-task-42:${user.id}`;

      // Simulate prior attempt that already committed to DB before worker crashed
      await testPrisma.notification.create({
        data: {
          userId: user.id,
          type: 'task_assigned',
          title: 'You were assigned to "Crash Recovery Task"',
          dedupeKey,
          data: { taskId: 'crashed-task-42', taskTitle: 'Crash Recovery Task' },
        },
      });

      expect(await testPrisma.notification.count({ where: { userId: user.id } })).toBe(1);

      // Now BullMQ retries the job
      await notificationQueue.add('fan-out-notification', {
        type: 'task_assigned',
        recipientId: user.id,
        title: 'You were assigned to "Crash Recovery Task"',
        dedupeKey,
        data: { taskId: 'crashed-task-42', taskTitle: 'Crash Recovery Task' },
      });

      await new Promise((r) => setTimeout(r, 250));

      // Must still be exactly 1 record, no duplicate created
      const countAfter = await testPrisma.notification.count({ where: { userId: user.id } });
      expect(countAfter).toBe(1);
    });

    it('idempotency: two separate legitimate events with identical titles are both preserved', async () => {
      const user = await testPrisma.user.create({
        data: {
          email: 'multi-event@test.com',
          passwordHash: 'hash',
          displayName: 'Multi Event User',
        },
      });

      // Two different tasks happen to have the exact same title ("Review PR")
      const event1 = {
        type: 'task_assigned' as const,
        recipientId: user.id,
        title: 'You were assigned to "Review PR"',
        dedupeKey: `task_assigned:task-project-A:${user.id}`,
        data: { taskId: 'task-project-A', taskTitle: 'Review PR' },
      };

      const event2 = {
        type: 'task_assigned' as const,
        recipientId: user.id,
        title: 'You were assigned to "Review PR"',
        dedupeKey: `task_assigned:task-project-B:${user.id}`,
        data: { taskId: 'task-project-B', taskTitle: 'Review PR' },
      };

      await notificationQueue.add('fan-out-notification', event1);
      await notificationQueue.add('fan-out-notification', event2);

      await waitForCondition(async () => {
        const count = await testPrisma.notification.count({ where: { userId: user.id } });
        return count === 2;
      });

      const userNotifications = await testPrisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
      });

      expect(userNotifications.length).toBe(2);
      expect(userNotifications[0].title).toBe('You were assigned to "Review PR"');
      expect(userNotifications[1].title).toBe('You were assigned to "Review PR"');
      expect(userNotifications[0].dedupeKey).toBe(`task_assigned:task-project-A:${user.id}`);
      expect(userNotifications[1].dedupeKey).toBe(`task_assigned:task-project-B:${user.id}`);
    });
  });

  // ─── 7. END-TO-END SERVICE ENQUEUEING ────────────────────

  describe('Service Event Enqueueing', () => {
    it('forgotPassword enqueues send-password-reset-email job', async () => {
      const user = await testPrisma.user.create({
        data: {
          email: 'forgotuser@test.com',
          passwordHash: 'hash',
          displayName: 'Forgot User',
        },
      });

      await forgotPassword('forgotuser@test.com');

      const jobs = await emailQueue.getJobs(['waiting', 'active', 'completed']);
      const resetJob = jobs.find((j) => j.name === 'send-password-reset-email' && j.data.to === 'forgotuser@test.com');

      expect(resetJob).toBeDefined();
      expect(resetJob?.data.to).toBe('forgotuser@test.com');
      expect(typeof resetJob?.data.rawToken).toBe('string');
    });

    it('inviteMember enqueues send-invitation-email and fan-out notification if existing user', async () => {
      const inviter = await testPrisma.user.create({
        data: { email: 'inviter@test.com', passwordHash: 'hash', displayName: 'Inviter' },
      });
      const invitee = await testPrisma.user.create({
        data: { email: 'existinginvitee@test.com', passwordHash: 'hash', displayName: 'Invitee' },
      });
      const org = await testPrisma.organization.create({
        data: { name: 'Acme Space', slug: 'acme-space', ownerId: inviter.id },
      });
      await testPrisma.orgMember.create({
        data: { orgId: org.id, userId: inviter.id, role: 'OWNER' },
      });

      await inviteMember(org.id, inviter.id, {
        email: 'existinginvitee@test.com',
        role: 'MEMBER',
      });

      const emailJobs = await emailQueue.getJobs(['waiting', 'active', 'completed']);
      const inviteEmailJob = emailJobs.find(
        (j) => j.name === 'send-invitation-email' && j.data.to === 'existinginvitee@test.com',
      );
      expect(inviteEmailJob).toBeDefined();
      expect(inviteEmailJob?.data.orgName).toBe('Acme Space');
      expect(inviteEmailJob?.data.inviterName).toBe('Inviter');

      const notifJobs = await notificationQueue.getJobs(['waiting', 'active', 'completed']);
      const inviteNotifJob = notifJobs.find(
        (j) => j.name === 'fan-out-notification' && j.data.recipientId === invitee.id,
      );
      expect(inviteNotifJob).toBeDefined();
      expect(inviteNotifJob?.data.type).toBe('invitation_received');
    });

    it('createTask with assignee enqueues task_assigned notification', async () => {
      const creator = await testPrisma.user.create({
        data: { email: 'creator@test.com', passwordHash: 'hash', displayName: 'Creator' },
      });
      const assignee = await testPrisma.user.create({
        data: { email: 'assignee@test.com', passwordHash: 'hash', displayName: 'Assignee' },
      });
      const org = await testPrisma.organization.create({
        data: { name: 'Dev Org', slug: 'dev-org', ownerId: creator.id },
      });
      await testPrisma.orgMember.createMany({
        data: [
          { orgId: org.id, userId: creator.id, role: 'OWNER' },
          { orgId: org.id, userId: assignee.id, role: 'MEMBER' },
        ],
      });
      const project = await testPrisma.project.create({
        data: {
          name: 'Backend API',
          organization: { connect: { id: org.id } },
          createdBy: { connect: { id: creator.id } },
        },
      });

      await createTask(org.id, project.id, creator.id, {
        title: 'Implement BullMQ Workers',
        assigneeId: assignee.id,
      });

      const notifJobs = await notificationQueue.getJobs(['waiting', 'active', 'completed']);
      const taskNotif = notifJobs.find(
        (j) => j.name === 'fan-out-notification' && j.data.recipientId === assignee.id,
      );
      expect(taskNotif).toBeDefined();
      expect(taskNotif?.data.type).toBe('task_assigned');
      expect(taskNotif?.data.title).toContain('Implement BullMQ Workers');
    });

    it('updateTask with new assignee enqueues task_assigned notification', async () => {
      const creator = await testPrisma.user.create({
        data: { email: 'owner@test.com', passwordHash: 'hash', displayName: 'Owner' },
      });
      const dev1 = await testPrisma.user.create({
        data: { email: 'dev1@test.com', passwordHash: 'hash', displayName: 'Dev One' },
      });
      const dev2 = await testPrisma.user.create({
        data: { email: 'dev2@test.com', passwordHash: 'hash', displayName: 'Dev Two' },
      });
      const org = await testPrisma.organization.create({
        data: { name: 'Tech Org', slug: 'tech-org', ownerId: creator.id },
      });
      await testPrisma.orgMember.createMany({
        data: [
          { orgId: org.id, userId: creator.id, role: 'OWNER' },
          { orgId: org.id, userId: dev1.id, role: 'MEMBER' },
          { orgId: org.id, userId: dev2.id, role: 'MEMBER' },
        ],
      });
      const project = await testPrisma.project.create({
        data: {
          name: 'Sprint App',
          organization: { connect: { id: org.id } },
          createdBy: { connect: { id: creator.id } },
        },
      });

      const task = await createTask(org.id, project.id, creator.id, {
        title: 'Refactor Auth',
        assigneeId: dev1.id,
      });

      await notificationQueue.drain();

      await updateTask(org.id, project.id, task.id, creator.id, {
        assigneeId: dev2.id,
      });

      const notifJobs = await notificationQueue.getJobs(['waiting', 'active', 'completed']);
      const reassignNotif = notifJobs.find(
        (j) => j.name === 'fan-out-notification' && j.data.recipientId === dev2.id,
      );
      expect(reassignNotif).toBeDefined();
      expect(reassignNotif?.data.type).toBe('task_assigned');
      expect(reassignNotif?.data.recipientId).toBe(dev2.id);
    });

    it('createComment enqueues comment_added notification for task assignee', async () => {
      const author = await testPrisma.user.create({
        data: { email: 'commenter@test.com', passwordHash: 'hash', displayName: 'Commenter' },
      });
      const assignee = await testPrisma.user.create({
        data: { email: 'taskassignee@test.com', passwordHash: 'hash', displayName: 'Task Assignee' },
      });
      const org = await testPrisma.organization.create({
        data: { name: 'Collab Org', slug: 'collab-org', ownerId: author.id },
      });
      await testPrisma.orgMember.createMany({
        data: [
          { orgId: org.id, userId: author.id, role: 'OWNER' },
          { orgId: org.id, userId: assignee.id, role: 'MEMBER' },
        ],
      });
      const project = await testPrisma.project.create({
        data: {
          name: 'UI Redesign',
          organization: { connect: { id: org.id } },
          createdBy: { connect: { id: author.id } },
        },
      });
      const task = await createTask(org.id, project.id, author.id, {
        title: 'Design System Tokens',
        assigneeId: assignee.id,
      });

      await notificationQueue.drain();

      await createComment(org.id, project.id, task.id, author.id, {
        body: 'Great progress on this ticket!',
      });

      const notifJobs = await notificationQueue.getJobs(['waiting', 'active', 'completed']);
      const commentNotif = notifJobs.find(
        (j) => j.name === 'fan-out-notification' && j.data.recipientId === assignee.id,
      );
      expect(commentNotif).toBeDefined();
      expect(commentNotif?.data.type).toBe('comment_added');
      expect(commentNotif?.data.title).toContain('Design System Tokens');
    });
  });
});
