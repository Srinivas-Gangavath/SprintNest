import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createTestAgent, registerUser, withCsrf } from '../helpers/request.js';
import { cleanDatabase, testPrisma } from '../helpers/db.js';
import type supertest from 'supertest';

// Helper: Create a notification directly in the DB for a specific user
async function seedNotification(userId: string, overrides: Record<string, any> = {}) {
  return testPrisma.notification.create({
    data: {
      userId,
      type: overrides.type || 'task_assigned',
      title: overrides.title || 'You were assigned a task',
      data: overrides.data || { taskId: '00000000-0000-0000-0000-000000000001' },
      isRead: overrides.isRead ?? false,
      ...('createdAt' in overrides ? { createdAt: overrides.createdAt } : {}),
    },
  });
}

describe('Notifications Module', () => {
  let agentA: ReturnType<typeof createTestAgent>;
  let agentB: ReturnType<typeof createTestAgent>;
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    await cleanDatabase();
  });

  beforeEach(async () => {
    await cleanDatabase();

    // Register User A
    agentA = createTestAgent();
    const resA = await registerUser(agentA, {
      email: 'userA@test.com',
      password: 'Password123!',
      displayName: 'User A',
    });
    userAId = resA.body.data.user.id;

    // Register User B
    agentB = createTestAgent();
    const resB = await registerUser(agentB, {
      email: 'userB@test.com',
      password: 'Password123!',
      displayName: 'User B',
    });
    userBId = resB.body.data.user.id;
  });

  // ─── LIST NOTIFICATIONS ─────────────────────────

  describe('GET /api/v1/notifications', () => {
    it('should return an empty list for a new user', async () => {
      const res = await agentA.get('/api/v1/notifications');
      expect(res.status).toBe(200);
      expect(res.body.data.notifications).toEqual([]);
      expect(res.body.data.pagination.total).toBe(0);
    });

    it('should reject unauthenticated requests', async () => {
      const unauthAgent = createTestAgent();
      const res = await unauthAgent.get('/api/v1/notifications');
      expect(res.status).toBe(401);
    });

    it('should return only notifications belonging to the authenticated user', async () => {
      // Seed: 2 for User A, 1 for User B
      await seedNotification(userAId, { title: 'A notification 1' });
      await seedNotification(userAId, { title: 'A notification 2' });
      await seedNotification(userBId, { title: 'B notification 1' });

      const resA = await agentA.get('/api/v1/notifications');
      expect(resA.status).toBe(200);
      expect(resA.body.data.notifications).toHaveLength(2);
      expect(resA.body.data.notifications.every((n: any) => n.userId === userAId)).toBe(true);

      const resB = await agentB.get('/api/v1/notifications');
      expect(resB.status).toBe(200);
      expect(resB.body.data.notifications).toHaveLength(1);
      expect(resB.body.data.notifications[0].userId).toBe(userBId);
    });

    it('should return newest notifications first', async () => {
      const older = await seedNotification(userAId, {
        title: 'Older',
        createdAt: new Date('2025-01-01'),
      });
      const newer = await seedNotification(userAId, {
        title: 'Newer',
        createdAt: new Date('2025-06-01'),
      });

      const res = await agentA.get('/api/v1/notifications');
      expect(res.status).toBe(200);
      expect(res.body.data.notifications[0].id).toBe(newer.id);
      expect(res.body.data.notifications[1].id).toBe(older.id);
    });

    it('should support pagination', async () => {
      // Create 5 notifications
      for (let i = 0; i < 5; i++) {
        await seedNotification(userAId, { title: `Notif ${i}` });
      }

      const page1 = await agentA.get('/api/v1/notifications?page=1&limit=2');
      expect(page1.status).toBe(200);
      expect(page1.body.data.notifications).toHaveLength(2);
      expect(page1.body.data.pagination.total).toBe(5);
      expect(page1.body.data.pagination.totalPages).toBe(3);
      expect(page1.body.data.pagination.page).toBe(1);

      const page2 = await agentA.get('/api/v1/notifications?page=2&limit=2');
      expect(page2.body.data.notifications).toHaveLength(2);

      const page3 = await agentA.get('/api/v1/notifications?page=3&limit=2');
      expect(page3.body.data.notifications).toHaveLength(1);
    });

    it('should support unread-only filtering', async () => {
      await seedNotification(userAId, { title: 'Unread 1', isRead: false });
      await seedNotification(userAId, { title: 'Unread 2', isRead: false });
      await seedNotification(userAId, { title: 'Read 1', isRead: true });

      const res = await agentA.get('/api/v1/notifications?unreadOnly=true');
      expect(res.status).toBe(200);
      expect(res.body.data.notifications).toHaveLength(2);
      expect(res.body.data.notifications.every((n: any) => n.isRead === false)).toBe(true);
    });
  });

  // ─── UNREAD COUNT ────────────────────────────────

  describe('GET /api/v1/notifications/unread-count', () => {
    it('should return the unread count for the authenticated user', async () => {
      await seedNotification(userAId, { isRead: false });
      await seedNotification(userAId, { isRead: false });
      await seedNotification(userAId, { isRead: true });
      await seedNotification(userBId, { isRead: false }); // different user

      const res = await agentA.get('/api/v1/notifications/unread-count');
      expect(res.status).toBe(200);
      expect(res.body.data.unreadCount).toBe(2);
    });
  });

  // ─── MARK ONE READ ──────────────────────────────

  describe('PATCH /api/v1/notifications/:notificationId/read', () => {
    it('should allow user to mark own notification as read', async () => {
      const notif = await seedNotification(userAId, { isRead: false });

      const res = await withCsrf(
        agentA.patch(`/api/v1/notifications/${notif.id}/read`),
      );
      expect(res.status).toBe(200);
      expect(res.body.data.notification.isRead).toBe(true);
    });

    it('should be idempotent — marking already-read notification is safe', async () => {
      const notif = await seedNotification(userAId, { isRead: true });

      const res = await withCsrf(
        agentA.patch(`/api/v1/notifications/${notif.id}/read`),
      );
      expect(res.status).toBe(200);
      expect(res.body.data.notification.isRead).toBe(true);
    });

    it('should prevent another user from marking someone else\'s notification as read', async () => {
      const notifA = await seedNotification(userAId, { isRead: false });

      const res = await withCsrf(
        agentB.patch(`/api/v1/notifications/${notifA.id}/read`),
      );
      expect(res.status).toBe(403);
    });

    it('should return 404 for a non-existent notification', async () => {
      const res = await withCsrf(
        agentA.patch('/api/v1/notifications/00000000-0000-0000-0000-000000000000/read'),
      );
      expect(res.status).toBe(404);
    });
  });

  // ─── MARK ALL READ ──────────────────────────────

  describe('POST /api/v1/notifications/read-all', () => {
    it('should mark all unread notifications for the current user as read', async () => {
      await seedNotification(userAId, { isRead: false, title: 'A1' });
      await seedNotification(userAId, { isRead: false, title: 'A2' });
      await seedNotification(userAId, { isRead: true, title: 'A3' });

      const res = await withCsrf(agentA.post('/api/v1/notifications/read-all'));
      expect(res.status).toBe(200);
      expect(res.body.data.updatedCount).toBe(2);

      // Verify all are now read
      const listRes = await agentA.get('/api/v1/notifications?unreadOnly=true');
      expect(listRes.body.data.notifications).toHaveLength(0);
    });

    it('should not affect another user\'s notifications', async () => {
      await seedNotification(userAId, { isRead: false, title: 'A1' });
      await seedNotification(userBId, { isRead: false, title: 'B1' });

      // User A marks all read
      await withCsrf(agentA.post('/api/v1/notifications/read-all'));

      // User B's notification should still be unread
      const resB = await agentB.get('/api/v1/notifications/unread-count');
      expect(resB.body.data.unreadCount).toBe(1);
    });

    it('should be safe to call when there are no unread notifications', async () => {
      const res = await withCsrf(agentA.post('/api/v1/notifications/read-all'));
      expect(res.status).toBe(200);
      expect(res.body.data.updatedCount).toBe(0);
    });
  });

  // ─── OWNERSHIP / SECURITY ──────────────────────

  describe('Ownership Isolation', () => {
    it('User B cannot read User A notifications via list', async () => {
      await seedNotification(userAId, { title: 'Secret for A' });

      const resB = await agentB.get('/api/v1/notifications');
      expect(resB.status).toBe(200);
      expect(resB.body.data.notifications).toHaveLength(0);
    });

    it('User B cannot mark User A notification via mark-read', async () => {
      const notifA = await seedNotification(userAId, { isRead: false });

      const res = await withCsrf(
        agentB.patch(`/api/v1/notifications/${notifA.id}/read`),
      );
      expect(res.status).toBe(403);

      // Verify it's still unread
      const check = await testPrisma.notification.findUnique({ where: { id: notifA.id } });
      expect(check?.isRead).toBe(false);
    });

    it('User B cannot affect User A notifications through read-all', async () => {
      await seedNotification(userAId, { isRead: false });

      await withCsrf(agentB.post('/api/v1/notifications/read-all'));

      // User A's notification still unread
      const resA = await agentA.get('/api/v1/notifications/unread-count');
      expect(resA.body.data.unreadCount).toBe(1);
    });
  });
});
