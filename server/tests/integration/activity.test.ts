import { describe, it, expect, beforeEach } from 'vitest';
import { createTestAgent, withCsrf, registerUser } from '../helpers/request.js';
import { cleanDatabase, testPrisma } from '../helpers/db.js';

describe('Activity log', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  const owner = { email: 'owner@test.com', password: 'Password123!', displayName: 'Owner' };
  const member = { email: 'member@test.com', password: 'Password123!', displayName: 'Member' };

  async function setup() {
    const ownerAgent = createTestAgent();
    await registerUser(ownerAgent, owner);
    const orgRes = await withCsrf(ownerAgent.post('/api/v1/orgs').send({ name: 'Alpha' }));
    const orgId = orgRes.body.data.organization.id as string;

    const memberAgent = createTestAgent();
    const memberRes = await registerUser(memberAgent, member);
    const memberId = memberRes.body.data.user.id as string;
    await testPrisma.orgMember.create({ data: { orgId, userId: memberId, role: 'MEMBER' } });

    await withCsrf(ownerAgent.post(`/api/v1/orgs/${orgId}/projects`).send({ name: 'Board' }));
    return { ownerAgent, memberAgent, orgId, memberId };
  }

  it('lets an owner page through this organization only', async () => {
    const { ownerAgent, orgId } = await setup();

    const other = createTestAgent();
    await registerUser(other, { email: 'beta@test.com', password: 'Password123!', displayName: 'Beta Owner' });
    const beta = await withCsrf(other.post('/api/v1/orgs').send({ name: 'Beta' }));
    const betaId = beta.body.data.organization.id as string;
    await withCsrf(other.post(`/api/v1/orgs/${betaId}/projects`).send({ name: 'Secret board' }));

    const page = await ownerAgent.get(`/api/v1/orgs/${orgId}/activity?limit=1&page=1`);
    expect(page.status).toBe(200);
    expect(page.body.data.activities).toHaveLength(1);
    expect(page.body.data.activities[0].orgId).toBe(orgId);
    expect(page.body.data.pagination.total).toBeGreaterThan(1);
    expect(page.body.data.activities[0].actor.displayName).toBe('Owner');
    expect(page.body.data.activities[0].summary).toBeTruthy();

    const serialized = JSON.stringify(page.body);
    expect(serialized).not.toContain('tokenHash');
    expect(serialized).not.toContain('rawToken');
    expect(serialized).not.toContain('Secret board');

    const all = await ownerAgent.get(`/api/v1/orgs/${orgId}/activity?limit=50`);
    const orgIds = all.body.data.activities.map((row: { orgId: string }) => row.orgId);
    expect(orgIds.every((id: string) => id === orgId)).toBe(true);
  });

  it('rejects members and allows admins', async () => {
    const { memberAgent, orgId, memberId } = await setup();

    const asMember = await memberAgent.get(`/api/v1/orgs/${orgId}/activity`);
    expect(asMember.status).toBe(403);

    await testPrisma.orgMember.update({
      where: { orgId_userId: { orgId, userId: memberId } },
      data: { role: 'ADMIN' },
    });

    const asAdmin = await memberAgent.get(`/api/v1/orgs/${orgId}/activity`);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.data.activities.length).toBeGreaterThan(0);

    const outsider = createTestAgent();
    await registerUser(outsider, { email: 'out@test.com', password: 'Password123!', displayName: 'Out' });
    const forbidden = await outsider.get(`/api/v1/orgs/${orgId}/activity`);
    expect(forbidden.status).toBe(403);
  });

  it('does not return invitation tokens in the log', async () => {
    const { ownerAgent, orgId } = await setup();
    const invited = await withCsrf(
      ownerAgent.post(`/api/v1/orgs/${orgId}/members/invitations`).send({
        email: 'invitee@test.com',
        role: 'MEMBER',
      }),
    );
    expect(invited.status).toBe(201);

    const page = await ownerAgent.get(`/api/v1/orgs/${orgId}/activity?limit=50`);
    const body = JSON.stringify(page.body);
    expect(body).toContain('invitee@test.com');
    expect(body).not.toContain('tokenHash');
    expect(body).not.toContain('rawToken');
    expect(page.body.data.activities.some((row: { action: string }) => row.action === 'member.invited')).toBe(true);
  });
});