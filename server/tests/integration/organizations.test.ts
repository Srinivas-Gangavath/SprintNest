import { describe, it, expect, beforeEach } from 'vitest';
import { createTestAgent, withCsrf, registerUser } from '../helpers/request.js';
import { cleanDatabase, testPrisma } from '../helpers/db.js';

describe('Organizations Module', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  const user1 = { email: 'user1@test.com', password: 'Password123!', displayName: 'User One' };
  const user2 = { email: 'user2@test.com', password: 'Password123!', displayName: 'User Two' };

  // ─── Create Organization ──────────────────────────

  describe('POST /api/v1/orgs', () => {
    it('should create an organization and make creator the owner', async () => {
      const agent = createTestAgent();
      await registerUser(agent, user1);

      const res = await withCsrf(
        agent.post('/api/v1/orgs').send({ name: 'Test Org' }),
      );

      expect(res.status).toBe(201);
      expect(res.body.data.organization.name).toBe('Test Org');
      expect(res.body.data.organization.slug).toBeDefined();

      // Verify owner membership was created
      const members = await testPrisma.orgMember.findMany({
        where: { orgId: res.body.data.organization.id },
      });
      expect(members).toHaveLength(1);
      expect(members[0].role).toBe('OWNER');
    });

    it('should require authentication', async () => {
      const res = await withCsrf(
        createTestAgent().post('/api/v1/orgs').send({ name: 'Test Org' }),
      );
      expect(res.status).toBe(401);
    });
  });

  // ─── List Organizations ───────────────────────────

  describe('GET /api/v1/orgs', () => {
    it('should list only user\'s organizations', async () => {
      const agent1 = createTestAgent();
      await registerUser(agent1, user1);
      await withCsrf(agent1.post('/api/v1/orgs').send({ name: 'Org One' }));
      await withCsrf(agent1.post('/api/v1/orgs').send({ name: 'Org Two' }));

      const agent2 = createTestAgent();
      await registerUser(agent2, user2);
      await withCsrf(agent2.post('/api/v1/orgs').send({ name: 'Org Three' }));

      const res1 = await agent1.get('/api/v1/orgs');
      expect(res1.status).toBe(200);
      expect(res1.body.data.organizations).toHaveLength(2);

      const res2 = await agent2.get('/api/v1/orgs');
      expect(res2.body.data.organizations).toHaveLength(1);
    });
  });

  // ─── Get Organization Details ─────────────────────

  describe('GET /api/v1/orgs/:orgId', () => {
    it('should return organization details for members', async () => {
      const agent = createTestAgent();
      await registerUser(agent, user1);
      const createRes = await withCsrf(agent.post('/api/v1/orgs').send({ name: 'My Org' }));
      const orgId = createRes.body.data.organization.id;

      const res = await agent.get(`/api/v1/orgs/${orgId}`);
      expect(res.status).toBe(200);
      expect(res.body.data.organization.name).toBe('My Org');
    });

    it('should reject non-members', async () => {
      const agent1 = createTestAgent();
      await registerUser(agent1, user1);
      const createRes = await withCsrf(agent1.post('/api/v1/orgs').send({ name: 'Private Org' }));
      const orgId = createRes.body.data.organization.id;

      const agent2 = createTestAgent();
      await registerUser(agent2, user2);
      const res = await agent2.get(`/api/v1/orgs/${orgId}`);
      expect(res.status).toBe(403);
    });
  });

  // ─── Update Organization ──────────────────────────

  describe('PATCH /api/v1/orgs/:orgId', () => {
    it('should allow owner to update', async () => {
      const agent = createTestAgent();
      await registerUser(agent, user1);
      const createRes = await withCsrf(agent.post('/api/v1/orgs').send({ name: 'Old Name' }));
      const orgId = createRes.body.data.organization.id;

      const res = await withCsrf(agent.patch(`/api/v1/orgs/${orgId}`).send({ name: 'New Name' }));
      expect(res.status).toBe(200);
      expect(res.body.data.organization.name).toBe('New Name');
    });
  });

  // ─── Delete Organization ──────────────────────────

  describe('DELETE /api/v1/orgs/:orgId', () => {
    it('should soft-delete organization (owner only)', async () => {
      const agent = createTestAgent();
      await registerUser(agent, user1);
      const createRes = await withCsrf(agent.post('/api/v1/orgs').send({ name: 'Doomed Org' }));
      const orgId = createRes.body.data.organization.id;

      const res = await withCsrf(agent.delete(`/api/v1/orgs/${orgId}`));
      expect(res.status).toBe(200);

      // Org should no longer be accessible
      const getRes = await agent.get(`/api/v1/orgs/${orgId}`);
      expect(getRes.status).toBe(404);
    });

    it('should hide soft-deleted orgs from list', async () => {
      const agent = createTestAgent();
      await registerUser(agent, user1);
      await withCsrf(agent.post('/api/v1/orgs').send({ name: 'Org A' }));
      const createRes = await withCsrf(agent.post('/api/v1/orgs').send({ name: 'Org B' }));
      const orgId = createRes.body.data.organization.id;

      await withCsrf(agent.delete(`/api/v1/orgs/${orgId}`));

      const listRes = await agent.get('/api/v1/orgs');
      expect(listRes.body.data.organizations).toHaveLength(1);
      expect(listRes.body.data.organizations[0].name).toBe('Org A');
    });
  });

  // ─── Membership RBAC ──────────────────────────────

  describe('Membership RBAC', () => {
    it('should allow member to view but not update org', async () => {
      // Create org with user1
      const agent1 = createTestAgent();
      await registerUser(agent1, user1);
      const createRes = await withCsrf(agent1.post('/api/v1/orgs').send({ name: 'RBAC Org' }));
      const orgId = createRes.body.data.organization.id;

      // Add user2 as MEMBER
      const agent2 = createTestAgent();
      const regRes2 = await registerUser(agent2, user2);
      const userId2 = regRes2.body.data.user.id;

      await testPrisma.orgMember.create({
        data: { orgId, userId: userId2, role: 'MEMBER' },
      });

      // Member can view
      const viewRes = await agent2.get(`/api/v1/orgs/${orgId}`);
      expect(viewRes.status).toBe(200);

      // Member cannot update
      const updateRes = await withCsrf(agent2.patch(`/api/v1/orgs/${orgId}`).send({ name: 'Hacked' }));
      expect(updateRes.status).toBe(403);

      // Member cannot delete
      const deleteRes = await withCsrf(agent2.delete(`/api/v1/orgs/${orgId}`));
      expect(deleteRes.status).toBe(403);
    });

    it('should prevent owner from removing themselves', async () => {
      const agent = createTestAgent();
      const regRes = await registerUser(agent, user1);
      const createRes = await withCsrf(agent.post('/api/v1/orgs').send({ name: 'My Org' }));
      const orgId = createRes.body.data.organization.id;

      // Find owner membership
      const ownerMember = await testPrisma.orgMember.findFirst({
        where: { orgId, role: 'OWNER' },
      });

      const res = await withCsrf(agent.delete(`/api/v1/orgs/${orgId}/members/${ownerMember!.id}`));
      expect(res.status).toBe(403);
    });
  });

  // ─── Activity Logging ─────────────────────────────

  describe('Activity logging', () => {
    it('should create activity log when org is created', async () => {
      const agent = createTestAgent();
      await registerUser(agent, user1);
      const createRes = await withCsrf(agent.post('/api/v1/orgs').send({ name: 'Audit Org' }));
      const orgId = createRes.body.data.organization.id;

      const logs = await testPrisma.activityLog.findMany({ where: { orgId } });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('org.created');
    });
  });
});
