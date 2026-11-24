import { describe, it, expect, beforeEach } from 'vitest';
import { createTestAgent, withCsrf, registerUser } from '../helpers/request.js';
import { cleanDatabase, testPrisma } from '../helpers/db.js';

describe('Labels Module', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  const user1 = { email: 'owner@test.com', password: 'Password123!', displayName: 'Owner' };
  const user2 = { email: 'member@test.com', password: 'Password123!', displayName: 'Member' };

  // ─── Helpers ──────────────────────────────────────────

  async function setupOrg() {
    const ownerAgent = createTestAgent();
    await registerUser(ownerAgent, user1);

    const createOrgRes = await withCsrf(ownerAgent.post('/api/v1/orgs').send({ name: 'Test Org' }));
    const orgId = createOrgRes.body.data.organization.id;

    const memberAgent = createTestAgent();
    const memberRes = await registerUser(memberAgent, user2);
    const memberId = memberRes.body.data.user.id;

    await testPrisma.orgMember.create({
      data: { orgId, userId: memberId, role: 'MEMBER' },
    });

    return { ownerAgent, memberAgent, orgId, memberId };
  }

  // ─── Create Label ─────────────────────────────────────

  describe('POST /api/v1/orgs/:orgId/labels', () => {
    it('should create a label', async () => {
      const { ownerAgent, orgId } = await setupOrg();

      const res = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/labels`).send({ name: 'Bug', color: '#FF0000' }),
      );

      expect(res.status).toBe(201);
      expect(res.body.data.label.name).toBe('Bug');
      expect(res.body.data.label.color).toBe('#FF0000');
      expect(res.body.data.label.orgId).toBe(orgId);
    });

    it('should use default color if not provided', async () => {
      const { ownerAgent, orgId } = await setupOrg();

      const res = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/labels`).send({ name: 'Feature' }),
      );

      expect(res.status).toBe(201);
      expect(res.body.data.label.color).toBe('#6B7280');
    });

    it('should reject duplicate label names within org', async () => {
      const { ownerAgent, orgId } = await setupOrg();

      await withCsrf(ownerAgent.post(`/api/v1/orgs/${orgId}/labels`).send({ name: 'Bug' }));
      const res = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/labels`).send({ name: 'Bug' }),
      );

      expect(res.status).toBe(409);
    });

    it('should reject member from creating labels (RBAC)', async () => {
      const { memberAgent, orgId } = await setupOrg();

      const res = await withCsrf(
        memberAgent.post(`/api/v1/orgs/${orgId}/labels`).send({ name: 'Blocked' }),
      );
      expect(res.status).toBe(403);
    });

    it('should create activity log', async () => {
      const { ownerAgent, orgId } = await setupOrg();

      await withCsrf(ownerAgent.post(`/api/v1/orgs/${orgId}/labels`).send({ name: 'Audit Label' }));

      const logs = await testPrisma.activityLog.findMany({
        where: { orgId, action: 'label.created' },
      });
      expect(logs).toHaveLength(1);
    });
  });

  // ─── List Labels ──────────────────────────────────────

  describe('GET /api/v1/orgs/:orgId/labels', () => {
    it('should list labels alphabetically', async () => {
      const { ownerAgent, orgId } = await setupOrg();

      await withCsrf(ownerAgent.post(`/api/v1/orgs/${orgId}/labels`).send({ name: 'Zzz' }));
      await withCsrf(ownerAgent.post(`/api/v1/orgs/${orgId}/labels`).send({ name: 'Aaa' }));

      const res = await ownerAgent.get(`/api/v1/orgs/${orgId}/labels`);
      expect(res.status).toBe(200);
      expect(res.body.data.labels).toHaveLength(2);
      expect(res.body.data.labels[0].name).toBe('Aaa');
    });

    it('should allow members to list labels', async () => {
      const { ownerAgent, memberAgent, orgId } = await setupOrg();

      await withCsrf(ownerAgent.post(`/api/v1/orgs/${orgId}/labels`).send({ name: 'Visible' }));

      const res = await memberAgent.get(`/api/v1/orgs/${orgId}/labels`);
      expect(res.status).toBe(200);
      expect(res.body.data.labels).toHaveLength(1);
    });
  });

  // ─── Update Label ─────────────────────────────────────

  describe('PATCH /api/v1/orgs/:orgId/labels/:labelId', () => {
    it('should update label name and color', async () => {
      const { ownerAgent, orgId } = await setupOrg();

      const createRes = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/labels`).send({ name: 'Old' }),
      );
      const labelId = createRes.body.data.label.id;

      const res = await withCsrf(
        ownerAgent.patch(`/api/v1/orgs/${orgId}/labels/${labelId}`).send({ name: 'New', color: '#00FF00' }),
      );
      expect(res.status).toBe(200);
      expect(res.body.data.label.name).toBe('New');
      expect(res.body.data.label.color).toBe('#00FF00');
    });

    it('should reject duplicate name on update', async () => {
      const { ownerAgent, orgId } = await setupOrg();

      await withCsrf(ownerAgent.post(`/api/v1/orgs/${orgId}/labels`).send({ name: 'Existing' }));
      const createRes = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/labels`).send({ name: 'ToRename' }),
      );
      const labelId = createRes.body.data.label.id;

      const res = await withCsrf(
        ownerAgent.patch(`/api/v1/orgs/${orgId}/labels/${labelId}`).send({ name: 'Existing' }),
      );
      expect(res.status).toBe(409);
    });
  });

  // ─── Delete Label ─────────────────────────────────────

  describe('DELETE /api/v1/orgs/:orgId/labels/:labelId', () => {
    it('should delete a label and cascade to task_labels', async () => {
      const { ownerAgent, orgId } = await setupOrg();

      // Create label
      const createLabelRes = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/labels`).send({ name: 'Deletable' }),
      );
      const labelId = createLabelRes.body.data.label.id;

      // Create project and task with label
      const projRes = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects`).send({ name: 'Test Project' }),
      );
      const projectId = projRes.body.data.project.id;

      await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({
          title: 'Labeled Task',
          labelIds: [labelId],
        }),
      );

      // Verify task_labels exists
      const taskLabelsBefore = await testPrisma.taskLabel.findMany({ where: { labelId } });
      expect(taskLabelsBefore).toHaveLength(1);

      // Delete label
      const res = await withCsrf(ownerAgent.delete(`/api/v1/orgs/${orgId}/labels/${labelId}`));
      expect(res.status).toBe(200);

      // Verify cascade - task_labels removed
      const taskLabelsAfter = await testPrisma.taskLabel.findMany({ where: { labelId } });
      expect(taskLabelsAfter).toHaveLength(0);

      // Label no longer in list
      const listRes = await ownerAgent.get(`/api/v1/orgs/${orgId}/labels`);
      expect(listRes.body.data.labels).toHaveLength(0);
    });
  });

  // ─── Cross-Org Label Isolation ────────────────────────

  describe('Cross-org label isolation', () => {
    it('should allow same label name in different orgs', async () => {
      const { ownerAgent, orgId } = await setupOrg();

      // Create label in org1
      await withCsrf(ownerAgent.post(`/api/v1/orgs/${orgId}/labels`).send({ name: 'Bug' }));

      // Create second org
      const org2Res = await withCsrf(ownerAgent.post('/api/v1/orgs').send({ name: 'Org Two' }));
      const org2Id = org2Res.body.data.organization.id;

      // Same label name should work in org2
      const res = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${org2Id}/labels`).send({ name: 'Bug' }),
      );
      expect(res.status).toBe(201);
    });
  });
});
