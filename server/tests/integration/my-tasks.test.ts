import { describe, it, expect, beforeEach } from 'vitest';
import { createTestAgent, withCsrf, registerUser } from '../helpers/request.js';
import { cleanDatabase, testPrisma } from '../helpers/db.js';

describe('My Tasks', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  const owner = { email: 'owner@test.com', password: 'Password123!', displayName: 'Owner' };
  const member = { email: 'member@test.com', password: 'Password123!', displayName: 'Member' };

  async function setup() {
    const ownerAgent = createTestAgent();
    const ownerRes = await registerUser(ownerAgent, owner);
    const ownerId = ownerRes.body.data.user.id as string;

    const orgRes = await withCsrf(ownerAgent.post('/api/v1/orgs').send({ name: 'Alpha' }));
    const orgId = orgRes.body.data.organization.id as string;

    const projectRes = await withCsrf(
      ownerAgent.post(`/api/v1/orgs/${orgId}/projects`).send({ name: 'Board' }),
    );
    const projectId = projectRes.body.data.project.id as string;

    const memberAgent = createTestAgent();
    const memberRes = await registerUser(memberAgent, member);
    const memberId = memberRes.body.data.user.id as string;
    await testPrisma.orgMember.create({ data: { orgId, userId: memberId, role: 'MEMBER' } });

    return { ownerAgent, memberAgent, orgId, projectId, ownerId, memberId };
  }

  it('returns only tasks assigned to the caller in this organization', async () => {
    const { ownerAgent, memberAgent, orgId, projectId, ownerId, memberId } = await setup();

    await withCsrf(
      ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({
        title: 'Owner task',
        assigneeId: ownerId,
        status: 'TODO',
        priority: 'HIGH',
      }),
    );
    await withCsrf(
      ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({
        title: 'Member task',
        assigneeId: memberId,
        status: 'TODO',
      }),
    );
    await withCsrf(
      ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({
        title: 'Unassigned',
      }),
    );

    const ownerList = await ownerAgent.get(`/api/v1/orgs/${orgId}/my-tasks`);
    expect(ownerList.status).toBe(200);
    expect(ownerList.body.data.tasks.map((task: { title: string }) => task.title)).toEqual(['Owner task']);
    expect(ownerList.body.data.tasks[0].project.name).toBe('Board');
    expect(ownerList.body.data.summary.TODO).toBe(1);
    expect(ownerList.body.data.summary.total).toBe(1);

    const memberList = await memberAgent.get(`/api/v1/orgs/${orgId}/my-tasks`);
    expect(memberList.status).toBe(200);
    expect(memberList.body.data.tasks.map((task: { title: string }) => task.title)).toEqual(['Member task']);
  });

  it('does not include tasks from another organization', async () => {
    const { ownerAgent, orgId, projectId, ownerId } = await setup();
    const otherOrg = await withCsrf(ownerAgent.post('/api/v1/orgs').send({ name: 'Beta' }));
    const otherOrgId = otherOrg.body.data.organization.id as string;
    const otherProject = await withCsrf(
      ownerAgent.post(`/api/v1/orgs/${otherOrgId}/projects`).send({ name: 'Other board' }),
    );
    const otherProjectId = otherProject.body.data.project.id as string;

    await withCsrf(
      ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({
        title: 'In Alpha',
        assigneeId: ownerId,
      }),
    );
    await withCsrf(
      ownerAgent.post(`/api/v1/orgs/${otherOrgId}/projects/${otherProjectId}/tasks`).send({
        title: 'In Beta',
        assigneeId: ownerId,
      }),
    );

    const alpha = await ownerAgent.get(`/api/v1/orgs/${orgId}/my-tasks`);
    const titles = alpha.body.data.tasks.map((task: { title: string }) => task.title);
    expect(titles).toContain('In Alpha');
    expect(titles).not.toContain('In Beta');
  });

  it('filters by status and paginates', async () => {
    const { ownerAgent, orgId, projectId, ownerId } = await setup();
    await withCsrf(
      ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({
        title: 'Todo one',
        assigneeId: ownerId,
        status: 'TODO',
      }),
    );
    await withCsrf(
      ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({
        title: 'Todo two',
        assigneeId: ownerId,
        status: 'TODO',
      }),
    );
    await withCsrf(
      ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({
        title: 'Done one',
        assigneeId: ownerId,
        status: 'DONE',
      }),
    );

    const filtered = await ownerAgent.get(`/api/v1/orgs/${orgId}/my-tasks?status=TODO&limit=1&page=1`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.tasks).toHaveLength(1);
    expect(filtered.body.data.tasks[0].status).toBe('TODO');
    expect(filtered.body.data.pagination.total).toBe(2);
    expect(filtered.body.data.pagination.totalPages).toBe(2);
    expect(filtered.body.data.summary.DONE).toBe(1);
    expect(filtered.body.data.summary.total).toBe(3);

    const page2 = await ownerAgent.get(`/api/v1/orgs/${orgId}/my-tasks?status=TODO&limit=1&page=2`);
    expect(page2.body.data.tasks).toHaveLength(1);
    expect(page2.body.data.tasks[0].id).not.toBe(filtered.body.data.tasks[0].id);
  });

  it('rejects an outsider and an invalid filter', async () => {
    const { ownerAgent, orgId } = await setup();
    const outsider = createTestAgent();
    await registerUser(outsider, { email: 'out@test.com', password: 'Password123!', displayName: 'Out' });

    const forbidden = await outsider.get(`/api/v1/orgs/${orgId}/my-tasks`);
    expect(forbidden.status).toBe(403);

    const bad = await ownerAgent.get(`/api/v1/orgs/${orgId}/my-tasks?status=NOT_A_STATUS`);
    expect(bad.status).toBe(400);
  });
});
