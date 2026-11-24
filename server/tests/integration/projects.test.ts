import { describe, it, expect, beforeEach } from 'vitest';
import { createTestAgent, withCsrf, registerUser } from '../helpers/request.js';
import { cleanDatabase, testPrisma } from '../helpers/db.js';

describe('Projects Module', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  const user1 = { email: 'owner@test.com', password: 'Password123!', displayName: 'Owner' };
  const user2 = { email: 'member@test.com', password: 'Password123!', displayName: 'Member' };

  // ─── Helpers ──────────────────────────────────────────

  async function setupOrgWithMember() {
    const ownerAgent = createTestAgent();
    const ownerRes = await registerUser(ownerAgent, user1);
    const ownerId = ownerRes.body.data.user.id;

    const createOrgRes = await withCsrf(ownerAgent.post('/api/v1/orgs').send({ name: 'Test Org' }));
    const orgId = createOrgRes.body.data.organization.id;

    // Register member
    const memberAgent = createTestAgent();
    const memberRes = await registerUser(memberAgent, user2);
    const memberId = memberRes.body.data.user.id;

    // Add as MEMBER directly
    await testPrisma.orgMember.create({
      data: { orgId, userId: memberId, role: 'MEMBER' },
    });

    return { ownerAgent, memberAgent, orgId, ownerId, memberId };
  }

  // ─── Create Project ───────────────────────────────────

  describe('POST /api/v1/orgs/:orgId/projects', () => {
    it('should allow owner to create a project', async () => {
      const { ownerAgent, orgId } = await setupOrgWithMember();

      const res = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects`).send({ name: 'My Project', description: 'A test project' }),
      );

      expect(res.status).toBe(201);
      expect(res.body.data.project.name).toBe('My Project');
      expect(res.body.data.project.orgId).toBe(orgId);
      expect(res.body.data.project.isArchived).toBe(false);
      expect(res.body.data.project.taskCounter).toBe(0);
    });

    it('should reject member from creating a project (RBAC)', async () => {
      const { memberAgent, orgId } = await setupOrgWithMember();

      const res = await withCsrf(
        memberAgent.post(`/api/v1/orgs/${orgId}/projects`).send({ name: 'Unauthorized' }),
      );

      expect(res.status).toBe(403);
    });

    it('should create activity log on project creation', async () => {
      const { ownerAgent, orgId } = await setupOrgWithMember();

      await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects`).send({ name: 'Audit Project' }),
      );

      const logs = await testPrisma.activityLog.findMany({
        where: { orgId, action: 'project.created' },
      });
      expect(logs).toHaveLength(1);
    });
  });

  // ─── List Projects ────────────────────────────────────

  describe('GET /api/v1/orgs/:orgId/projects', () => {
    it('should list projects and exclude archived by default', async () => {
      const { ownerAgent, orgId } = await setupOrgWithMember();

      await withCsrf(ownerAgent.post(`/api/v1/orgs/${orgId}/projects`).send({ name: 'Project A' }));
      const bRes = await withCsrf(ownerAgent.post(`/api/v1/orgs/${orgId}/projects`).send({ name: 'Project B' }));
      const projectBId = bRes.body.data.project.id;

      // Archive Project B
      await withCsrf(
        ownerAgent.patch(`/api/v1/orgs/${orgId}/projects/${projectBId}/archive`).send({ isArchived: true }),
      );

      // Default list excludes archived
      const listRes = await ownerAgent.get(`/api/v1/orgs/${orgId}/projects`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.projects).toHaveLength(1);
      expect(listRes.body.data.projects[0].name).toBe('Project A');

      // Include archived
      const listAllRes = await ownerAgent.get(`/api/v1/orgs/${orgId}/projects?includeArchived=true`);
      expect(listAllRes.body.data.projects).toHaveLength(2);
    });

    it('should allow members to list projects', async () => {
      const { ownerAgent, memberAgent, orgId } = await setupOrgWithMember();

      await withCsrf(ownerAgent.post(`/api/v1/orgs/${orgId}/projects`).send({ name: 'Visible' }));

      const res = await memberAgent.get(`/api/v1/orgs/${orgId}/projects`);
      expect(res.status).toBe(200);
      expect(res.body.data.projects).toHaveLength(1);
    });
  });

  // ─── Get Project ──────────────────────────────────────

  describe('GET /api/v1/orgs/:orgId/projects/:projectId', () => {
    it('should return project details', async () => {
      const { ownerAgent, orgId } = await setupOrgWithMember();

      const createRes = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects`).send({ name: 'Detail Project' }),
      );
      const projectId = createRes.body.data.project.id;

      const res = await ownerAgent.get(`/api/v1/orgs/${orgId}/projects/${projectId}`);
      expect(res.status).toBe(200);
      expect(res.body.data.project.name).toBe('Detail Project');
      expect(res.body.data.project.taskCount).toBe(0);
    });

    it('should reject non-members', async () => {
      const { ownerAgent, orgId } = await setupOrgWithMember();

      const createRes = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects`).send({ name: 'Private' }),
      );
      const projectId = createRes.body.data.project.id;

      // New user not in org
      const outsiderAgent = createTestAgent();
      await registerUser(outsiderAgent, { email: 'outsider@test.com', password: 'Password123!', displayName: 'Outsider' });

      const res = await outsiderAgent.get(`/api/v1/orgs/${orgId}/projects/${projectId}`);
      expect(res.status).toBe(403);
    });
  });

  // ─── Update Project ───────────────────────────────────

  describe('PATCH /api/v1/orgs/:orgId/projects/:projectId', () => {
    it('should allow owner to update', async () => {
      const { ownerAgent, orgId } = await setupOrgWithMember();

      const createRes = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects`).send({ name: 'Old Name' }),
      );
      const projectId = createRes.body.data.project.id;

      const res = await withCsrf(
        ownerAgent.patch(`/api/v1/orgs/${orgId}/projects/${projectId}`).send({ name: 'New Name' }),
      );
      expect(res.status).toBe(200);
      expect(res.body.data.project.name).toBe('New Name');
    });

    it('should reject member from updating', async () => {
      const { ownerAgent, memberAgent, orgId } = await setupOrgWithMember();

      const createRes = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects`).send({ name: 'Protected' }),
      );
      const projectId = createRes.body.data.project.id;

      const res = await withCsrf(
        memberAgent.patch(`/api/v1/orgs/${orgId}/projects/${projectId}`).send({ name: 'Hacked' }),
      );
      expect(res.status).toBe(403);
    });
  });

  // ─── Archive Project ──────────────────────────────────

  describe('PATCH /api/v1/orgs/:orgId/projects/:projectId/archive', () => {
    it('should archive and unarchive a project', async () => {
      const { ownerAgent, orgId } = await setupOrgWithMember();

      const createRes = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects`).send({ name: 'Archivable' }),
      );
      const projectId = createRes.body.data.project.id;

      // Archive
      const archiveRes = await withCsrf(
        ownerAgent.patch(`/api/v1/orgs/${orgId}/projects/${projectId}/archive`).send({ isArchived: true }),
      );
      expect(archiveRes.status).toBe(200);
      expect(archiveRes.body.data.project.isArchived).toBe(true);

      // Unarchive
      const unarchiveRes = await withCsrf(
        ownerAgent.patch(`/api/v1/orgs/${orgId}/projects/${projectId}/archive`).send({ isArchived: false }),
      );
      expect(unarchiveRes.status).toBe(200);
      expect(unarchiveRes.body.data.project.isArchived).toBe(false);
    });
  });

  // ─── Cross-Org Isolation ──────────────────────────────

  describe('Cross-org isolation', () => {
    it('should not allow accessing a project from another org', async () => {
      const { ownerAgent, orgId } = await setupOrgWithMember();

      // Create project in org1
      const createRes = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects`).send({ name: 'Org1 Project' }),
      );
      const projectId = createRes.body.data.project.id;

      // Create a second org
      const org2Res = await withCsrf(ownerAgent.post('/api/v1/orgs').send({ name: 'Org Two' }));
      const org2Id = org2Res.body.data.organization.id;

      // Try to access project via org2
      const res = await ownerAgent.get(`/api/v1/orgs/${org2Id}/projects/${projectId}`);
      expect(res.status).toBe(404);
    });
  });
});
