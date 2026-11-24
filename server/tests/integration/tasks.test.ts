import { describe, it, expect, beforeEach } from 'vitest';
import { createTestAgent, withCsrf, registerUser } from '../helpers/request.js';
import { cleanDatabase, testPrisma } from '../helpers/db.js';

describe('Tasks Module', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  const user1 = { email: 'owner@test.com', password: 'Password123!', displayName: 'Owner' };
  const user2 = { email: 'member@test.com', password: 'Password123!', displayName: 'Member' };

  // ─── Helpers ──────────────────────────────────────────

  async function setupOrgAndProject() {
    const ownerAgent = createTestAgent();
    const ownerRes = await registerUser(ownerAgent, user1);
    const ownerId = ownerRes.body.data.user.id;

    const createOrgRes = await withCsrf(ownerAgent.post('/api/v1/orgs').send({ name: 'Test Org' }));
    const orgId = createOrgRes.body.data.organization.id;

    // Create project
    const createProjRes = await withCsrf(
      ownerAgent.post(`/api/v1/orgs/${orgId}/projects`).send({ name: 'Test Project' }),
    );
    const projectId = createProjRes.body.data.project.id;

    // Register member
    const memberAgent = createTestAgent();
    const memberRes = await registerUser(memberAgent, user2);
    const memberId = memberRes.body.data.user.id;

    await testPrisma.orgMember.create({
      data: { orgId, userId: memberId, role: 'MEMBER' },
    });

    return { ownerAgent, memberAgent, orgId, projectId, ownerId, memberId };
  }

  // ─── Create Task ──────────────────────────────────────

  describe('POST /api/v1/orgs/:orgId/projects/:projectId/tasks', () => {
    it('should create a task with atomic task number', async () => {
      const { ownerAgent, orgId, projectId } = await setupOrgAndProject();

      const res1 = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({ title: 'First Task' }),
      );
      expect(res1.status).toBe(201);
      expect(res1.body.data.task.taskNumber).toBe(1);
      expect(res1.body.data.task.title).toBe('First Task');
      expect(res1.body.data.task.status).toBe('BACKLOG');
      expect(res1.body.data.task.priority).toBe('NONE');

      const res2 = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({ title: 'Second Task' }),
      );
      expect(res2.body.data.task.taskNumber).toBe(2);
    });

    it('should allow members to create tasks', async () => {
      const { memberAgent, orgId, projectId } = await setupOrgAndProject();

      const res = await withCsrf(
        memberAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({ title: 'Member Task' }),
      );
      expect(res.status).toBe(201);
    });

    it('should validate assignee is an org member', async () => {
      const { ownerAgent, orgId, projectId } = await setupOrgAndProject();

      // Register a user NOT in the org
      const outsiderAgent = createTestAgent();
      const outsiderRes = await registerUser(outsiderAgent, {
        email: 'outsider@test.com', password: 'Password123!', displayName: 'Outsider',
      });
      const outsiderId = outsiderRes.body.data.user.id;

      const res = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({
          title: 'Bad Assignment',
          assigneeId: outsiderId,
        }),
      );
      expect(res.status).toBe(400);
    });

    it('should allow assigning to a valid org member', async () => {
      const { ownerAgent, orgId, projectId, memberId } = await setupOrgAndProject();

      const res = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({
          title: 'Assigned Task',
          assigneeId: memberId,
        }),
      );
      expect(res.status).toBe(201);
      expect(res.body.data.task.assignee.id).toBe(memberId);
    });

    it('should set completedAt when status is DONE', async () => {
      const { ownerAgent, orgId, projectId } = await setupOrgAndProject();

      const res = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({
          title: 'Done Task',
          status: 'DONE',
        }),
      );
      expect(res.status).toBe(201);
      expect(res.body.data.task.completedAt).not.toBeNull();
    });

    it('should create activity log', async () => {
      const { ownerAgent, orgId, projectId } = await setupOrgAndProject();

      await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({ title: 'Audit Task' }),
      );

      const logs = await testPrisma.activityLog.findMany({
        where: { orgId, action: 'task.created' },
      });
      expect(logs).toHaveLength(1);
    });
  });

  // ─── List Tasks ───────────────────────────────────────

  describe('GET /api/v1/orgs/:orgId/projects/:projectId/tasks', () => {
    it('should list tasks with pagination', async () => {
      const { ownerAgent, orgId, projectId } = await setupOrgAndProject();

      for (let i = 1; i <= 3; i++) {
        await withCsrf(
          ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({ title: `Task ${i}` }),
        );
      }

      const res = await ownerAgent.get(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks?limit=2&page=1`);
      expect(res.status).toBe(200);
      expect(res.body.data.tasks).toHaveLength(2);
      expect(res.body.data.pagination.total).toBe(3);
      expect(res.body.data.pagination.totalPages).toBe(2);
    });

    it('should filter by status', async () => {
      const { ownerAgent, orgId, projectId } = await setupOrgAndProject();

      await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({ title: 'Backlog', status: 'BACKLOG' }),
      );
      await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({ title: 'In Progress', status: 'IN_PROGRESS' }),
      );

      const res = await ownerAgent.get(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks?status=IN_PROGRESS`);
      expect(res.body.data.tasks).toHaveLength(1);
      expect(res.body.data.tasks[0].title).toBe('In Progress');
    });

    it('should filter by priority', async () => {
      const { ownerAgent, orgId, projectId } = await setupOrgAndProject();

      await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({ title: 'Low', priority: 'LOW' }),
      );
      await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({ title: 'High', priority: 'HIGH' }),
      );

      const res = await ownerAgent.get(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks?priority=HIGH`);
      expect(res.body.data.tasks).toHaveLength(1);
      expect(res.body.data.tasks[0].title).toBe('High');
    });

    it('should filter by assignee', async () => {
      const { ownerAgent, orgId, projectId, memberId } = await setupOrgAndProject();

      await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({ title: 'Assigned', assigneeId: memberId }),
      );
      await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({ title: 'Unassigned' }),
      );

      const res = await ownerAgent.get(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks?assigneeId=${memberId}`);
      expect(res.body.data.tasks).toHaveLength(1);
      expect(res.body.data.tasks[0].title).toBe('Assigned');
    });
  });

  // ─── Update Task ──────────────────────────────────────

  describe('PATCH /api/v1/orgs/:orgId/projects/:projectId/tasks/:taskId', () => {
    it('should update task fields', async () => {
      const { ownerAgent, orgId, projectId } = await setupOrgAndProject();

      const createRes = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({ title: 'Original' }),
      );
      const taskId = createRes.body.data.task.id;

      const res = await withCsrf(
        ownerAgent.patch(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks/${taskId}`).send({
          title: 'Updated',
          priority: 'HIGH',
        }),
      );
      expect(res.status).toBe(200);
      expect(res.body.data.task.title).toBe('Updated');
      expect(res.body.data.task.priority).toBe('HIGH');
    });

    it('should set completedAt when transitioning to DONE', async () => {
      const { ownerAgent, orgId, projectId } = await setupOrgAndProject();

      const createRes = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({ title: 'To Complete' }),
      );
      const taskId = createRes.body.data.task.id;

      // Transition to DONE
      const doneRes = await withCsrf(
        ownerAgent.patch(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks/${taskId}`).send({ status: 'DONE' }),
      );
      expect(doneRes.body.data.task.completedAt).not.toBeNull();

      // Transition back to TODO — should clear completedAt
      const todoRes = await withCsrf(
        ownerAgent.patch(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks/${taskId}`).send({ status: 'TODO' }),
      );
      expect(todoRes.body.data.task.completedAt).toBeNull();
    });

    it('should unassign by setting assigneeId to null', async () => {
      const { ownerAgent, orgId, projectId, memberId } = await setupOrgAndProject();

      const createRes = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({
          title: 'Assigned',
          assigneeId: memberId,
        }),
      );
      const taskId = createRes.body.data.task.id;

      const res = await withCsrf(
        ownerAgent.patch(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks/${taskId}`).send({ assigneeId: null }),
      );
      expect(res.body.data.task.assignee).toBeNull();
    });
  });

  // ─── Delete Task ──────────────────────────────────────

  describe('DELETE /api/v1/orgs/:orgId/projects/:projectId/tasks/:taskId', () => {
    it('should delete a task', async () => {
      const { ownerAgent, orgId, projectId } = await setupOrgAndProject();

      const createRes = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({ title: 'Doomed' }),
      );
      const taskId = createRes.body.data.task.id;

      const res = await withCsrf(
        ownerAgent.delete(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks/${taskId}`),
      );
      expect(res.status).toBe(200);

      // Verify it's gone
      const getRes = await ownerAgent.get(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks/${taskId}`);
      expect(getRes.status).toBe(404);
    });
  });

  // ─── Get one task (deep link) ─────────────────────────

  describe('GET /api/v1/orgs/:orgId/projects/:projectId/tasks/:taskId', () => {
    it('returns the task to a member of the organization', async () => {
      const { memberAgent, ownerAgent, orgId, projectId } = await setupOrgAndProject();

      const createRes = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({ title: 'Deep link' }),
      );
      const taskId = createRes.body.data.task.id;

      const res = await memberAgent.get(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks/${taskId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.task.id).toBe(taskId);
      expect(res.body.data.task.title).toBe('Deep link');
    });

    it('returns 404 when the task does not exist', async () => {
      const { ownerAgent, orgId, projectId } = await setupOrgAndProject();

      const res = await ownerAgent.get(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tasks/00000000-0000-4000-8000-000000000000`,
      );

      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('taskNumber');
    });

    it('returns 403 for a user outside the organization and does not include the task', async () => {
      const { ownerAgent, orgId, projectId } = await setupOrgAndProject();

      const createRes = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({ title: 'Private task' }),
      );
      const taskId = createRes.body.data.task.id;

      const outsider = createTestAgent();
      await registerUser(outsider, {
        email: 'outsider-task@test.com',
        password: 'Password123!',
        displayName: 'Outsider',
      });

      const res = await outsider.get(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks/${taskId}`);

      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain('Private task');
    });
  });

  // ─── Cross-Org Task Isolation ─────────────────────────

  describe('Cross-org task isolation', () => {
    it('should not allow accessing tasks through another org', async () => {
      const { ownerAgent, orgId, projectId } = await setupOrgAndProject();

      // Create a task
      const createRes = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({ title: 'Isolated Task' }),
      );
      const taskId = createRes.body.data.task.id;

      // Create second org + project
      const org2Res = await withCsrf(ownerAgent.post('/api/v1/orgs').send({ name: 'Org Two' }));
      const org2Id = org2Res.body.data.organization.id;

      // Trying to access the project from org2 should fail
      const res = await ownerAgent.get(`/api/v1/orgs/${org2Id}/projects/${projectId}/tasks/${taskId}`);
      expect(res.status).toBe(404);
    });
  });
});
