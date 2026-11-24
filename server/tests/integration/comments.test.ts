import { describe, it, expect, beforeEach } from 'vitest';
import { createTestAgent, withCsrf, registerUser } from '../helpers/request.js';
import { cleanDatabase, testPrisma } from '../helpers/db.js';

describe('Comments Module', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  const user1 = { email: 'owner@test.com', password: 'Password123!', displayName: 'Owner' };
  const user2 = { email: 'member@test.com', password: 'Password123!', displayName: 'Member' };
  const user3 = { email: 'outsider@test.com', password: 'Password123!', displayName: 'Outsider' };

  // ─── Helpers ──────────────────────────────────────────

  async function setupOrgProjectTask() {
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

    // Create task
    const createTaskRes = await withCsrf(
      ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({ title: 'Test Task' }),
    );
    const taskId = createTaskRes.body.data.task.id;

    // Register member and add to org
    const memberAgent = createTestAgent();
    const memberRes = await registerUser(memberAgent, user2);
    const memberId = memberRes.body.data.user.id;

    await testPrisma.orgMember.create({
      data: { orgId, userId: memberId, role: 'MEMBER' },
    });

    return { ownerAgent, memberAgent, orgId, projectId, taskId, ownerId, memberId };
  }

  function commentUrl(orgId: string, projectId: string, taskId: string) {
    return `/api/v1/orgs/${orgId}/projects/${projectId}/tasks/${taskId}/comments`;
  }

  // ─── Create Comment ──────────────────────────────────

  describe('POST /comments', () => {
    it('should create a comment on a task', async () => {
      const { ownerAgent, orgId, projectId, taskId } = await setupOrgProjectTask();

      const res = await withCsrf(
        ownerAgent.post(commentUrl(orgId, projectId, taskId)).send({ body: 'Hello world' }),
      );

      expect(res.status).toBe(201);
      expect(res.body.data.comment.body).toBe('Hello world');
      expect(res.body.data.comment.isEdited).toBe(false);
      expect(res.body.data.comment.parentId).toBeNull();
      expect(res.body.data.comment.author.displayName).toBe('Owner');
    });

    it('should allow a member to create a comment', async () => {
      const { memberAgent, orgId, projectId, taskId } = await setupOrgProjectTask();

      const res = await withCsrf(
        memberAgent.post(commentUrl(orgId, projectId, taskId)).send({ body: 'Member comment' }),
      );

      expect(res.status).toBe(201);
      expect(res.body.data.comment.body).toBe('Member comment');
    });

    it('should reject empty body', async () => {
      const { ownerAgent, orgId, projectId, taskId } = await setupOrgProjectTask();

      const res = await withCsrf(
        ownerAgent.post(commentUrl(orgId, projectId, taskId)).send({ body: '' }),
      );

      expect(res.status).toBe(400);
    });

    it('should reject unauthenticated request', async () => {
      const { orgId, projectId, taskId } = await setupOrgProjectTask();

      const anonAgent = createTestAgent();
      const res = await withCsrf(
        anonAgent.post(commentUrl(orgId, projectId, taskId)).send({ body: 'Anon' }),
      );

      expect(res.status).toBe(401);
    });

    it('should create a reply to a top-level comment', async () => {
      const { ownerAgent, orgId, projectId, taskId } = await setupOrgProjectTask();

      // Create parent comment
      const parentRes = await withCsrf(
        ownerAgent.post(commentUrl(orgId, projectId, taskId)).send({ body: 'Parent comment' }),
      );
      const parentId = parentRes.body.data.comment.id;

      // Reply to parent
      const replyRes = await withCsrf(
        ownerAgent
          .post(commentUrl(orgId, projectId, taskId))
          .send({ body: 'Reply comment', parentId }),
      );

      expect(replyRes.status).toBe(201);
      expect(replyRes.body.data.comment.parentId).toBe(parentId);
    });

    it('should reject reply to a reply (no deep nesting)', async () => {
      const { ownerAgent, orgId, projectId, taskId } = await setupOrgProjectTask();

      // Create parent comment
      const parentRes = await withCsrf(
        ownerAgent.post(commentUrl(orgId, projectId, taskId)).send({ body: 'Parent' }),
      );
      const parentId = parentRes.body.data.comment.id;

      // Create reply
      const replyRes = await withCsrf(
        ownerAgent
          .post(commentUrl(orgId, projectId, taskId))
          .send({ body: 'Reply', parentId }),
      );
      const replyId = replyRes.body.data.comment.id;

      // Try to reply to the reply
      const deepRes = await withCsrf(
        ownerAgent
          .post(commentUrl(orgId, projectId, taskId))
          .send({ body: 'Deep reply', parentId: replyId }),
      );

      expect(deepRes.status).toBe(400);
      expect(deepRes.body.message).toMatch(/one level/i);
    });

    it('should reject parent comment from a different task', async () => {
      const { ownerAgent, orgId, projectId, taskId } = await setupOrgProjectTask();

      // Create second task
      const task2Res = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({ title: 'Task 2' }),
      );
      const task2Id = task2Res.body.data.task.id;

      // Create comment on task 2
      const otherRes = await withCsrf(
        ownerAgent.post(commentUrl(orgId, projectId, task2Id)).send({ body: 'Other task' }),
      );
      const otherCommentId = otherRes.body.data.comment.id;

      // Try to use that comment as parent on task 1
      const res = await withCsrf(
        ownerAgent
          .post(commentUrl(orgId, projectId, taskId))
          .send({ body: 'Cross-task reply', parentId: otherCommentId }),
      );

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/parent comment not found/i);
    });
  });

  // ─── List Comments ──────────────────────────────────

  describe('GET /comments', () => {
    it('should list comments for a task', async () => {
      const { ownerAgent, orgId, projectId, taskId } = await setupOrgProjectTask();

      await withCsrf(ownerAgent.post(commentUrl(orgId, projectId, taskId)).send({ body: 'Comment 1' }));
      await withCsrf(ownerAgent.post(commentUrl(orgId, projectId, taskId)).send({ body: 'Comment 2' }));

      const res = await ownerAgent.get(commentUrl(orgId, projectId, taskId));

      expect(res.status).toBe(200);
      expect(res.body.data.comments).toHaveLength(2);
      expect(res.body.data.comments[0].body).toBe('Comment 1');
      expect(res.body.data.comments[1].body).toBe('Comment 2');
    });

    it('should return replies nested under parent', async () => {
      const { ownerAgent, orgId, projectId, taskId } = await setupOrgProjectTask();

      const parentRes = await withCsrf(
        ownerAgent.post(commentUrl(orgId, projectId, taskId)).send({ body: 'Parent' }),
      );
      const parentId = parentRes.body.data.comment.id;

      await withCsrf(
        ownerAgent
          .post(commentUrl(orgId, projectId, taskId))
          .send({ body: 'Reply', parentId }),
      );

      const res = await ownerAgent.get(commentUrl(orgId, projectId, taskId));

      expect(res.body.data.comments).toHaveLength(1); // only top-level
      expect(res.body.data.comments[0].replies).toHaveLength(1);
      expect(res.body.data.comments[0].replies[0].body).toBe('Reply');
    });

    it('should not return comments from a different task', async () => {
      const { ownerAgent, orgId, projectId, taskId } = await setupOrgProjectTask();

      // Create second task + comment
      const task2Res = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({ title: 'Task 2' }),
      );
      const task2Id = task2Res.body.data.task.id;
      await withCsrf(
        ownerAgent.post(commentUrl(orgId, projectId, task2Id)).send({ body: 'Task 2 comment' }),
      );

      // Comment on task 1
      await withCsrf(
        ownerAgent.post(commentUrl(orgId, projectId, taskId)).send({ body: 'Task 1 comment' }),
      );

      const res = await ownerAgent.get(commentUrl(orgId, projectId, taskId));
      expect(res.body.data.comments).toHaveLength(1);
      expect(res.body.data.comments[0].body).toBe('Task 1 comment');
    });
  });

  // ─── Update Comment ──────────────────────────────────

  describe('PATCH /comments/:commentId', () => {
    it('should allow author to edit their comment', async () => {
      const { memberAgent, orgId, projectId, taskId } = await setupOrgProjectTask();

      const createRes = await withCsrf(
        memberAgent.post(commentUrl(orgId, projectId, taskId)).send({ body: 'Original' }),
      );
      const commentId = createRes.body.data.comment.id;

      const res = await withCsrf(
        memberAgent
          .patch(`${commentUrl(orgId, projectId, taskId)}/${commentId}`)
          .send({ body: 'Updated' }),
      );

      expect(res.status).toBe(200);
      expect(res.body.data.comment.body).toBe('Updated');
      expect(res.body.data.comment.isEdited).toBe(true);
    });

    it('should reject edit by a different non-admin user', async () => {
      const { ownerAgent, memberAgent, orgId, projectId, taskId } = await setupOrgProjectTask();

      // Owner creates comment
      const createRes = await withCsrf(
        ownerAgent.post(commentUrl(orgId, projectId, taskId)).send({ body: 'Owner comment' }),
      );
      const commentId = createRes.body.data.comment.id;

      // Member tries to edit
      const res = await withCsrf(
        memberAgent
          .patch(`${commentUrl(orgId, projectId, taskId)}/${commentId}`)
          .send({ body: 'Hijacked!' }),
      );

      expect(res.status).toBe(403);
    });

    it('should allow org owner/admin to moderate (edit) any comment', async () => {
      const { ownerAgent, memberAgent, orgId, projectId, taskId } = await setupOrgProjectTask();

      // Member creates comment
      const createRes = await withCsrf(
        memberAgent.post(commentUrl(orgId, projectId, taskId)).send({ body: 'Member msg' }),
      );
      const commentId = createRes.body.data.comment.id;

      // Owner edits it
      const res = await withCsrf(
        ownerAgent
          .patch(`${commentUrl(orgId, projectId, taskId)}/${commentId}`)
          .send({ body: 'Moderated by owner' }),
      );

      expect(res.status).toBe(200);
      expect(res.body.data.comment.body).toBe('Moderated by owner');
    });
  });

  // ─── Delete Comment ──────────────────────────────────

  describe('DELETE /comments/:commentId', () => {
    it('should allow author to delete their comment', async () => {
      const { memberAgent, orgId, projectId, taskId } = await setupOrgProjectTask();

      const createRes = await withCsrf(
        memberAgent.post(commentUrl(orgId, projectId, taskId)).send({ body: 'To delete' }),
      );
      const commentId = createRes.body.data.comment.id;

      const res = await withCsrf(
        memberAgent.delete(`${commentUrl(orgId, projectId, taskId)}/${commentId}`),
      );

      expect(res.status).toBe(200);

      // Verify deleted
      const listRes = await memberAgent.get(commentUrl(orgId, projectId, taskId));
      expect(listRes.body.data.comments).toHaveLength(0);
    });

    it('should reject deletion by a different non-admin user', async () => {
      const { ownerAgent, memberAgent, orgId, projectId, taskId } = await setupOrgProjectTask();

      const createRes = await withCsrf(
        ownerAgent.post(commentUrl(orgId, projectId, taskId)).send({ body: 'Owner comment' }),
      );
      const commentId = createRes.body.data.comment.id;

      const res = await withCsrf(
        memberAgent.delete(`${commentUrl(orgId, projectId, taskId)}/${commentId}`),
      );

      expect(res.status).toBe(403);
    });

    it('should delete replies when parent is deleted', async () => {
      const { ownerAgent, orgId, projectId, taskId } = await setupOrgProjectTask();

      const parentRes = await withCsrf(
        ownerAgent.post(commentUrl(orgId, projectId, taskId)).send({ body: 'Parent' }),
      );
      const parentId = parentRes.body.data.comment.id;

      await withCsrf(
        ownerAgent
          .post(commentUrl(orgId, projectId, taskId))
          .send({ body: 'Reply', parentId }),
      );

      // Delete parent
      await withCsrf(
        ownerAgent.delete(`${commentUrl(orgId, projectId, taskId)}/${parentId}`),
      );

      // Verify all gone
      const listRes = await ownerAgent.get(commentUrl(orgId, projectId, taskId));
      expect(listRes.body.data.comments).toHaveLength(0);
    });
  });

  // ─── Cross-Org Isolation ─────────────────────────────

  describe('Cross-org comment isolation', () => {
    it('should reject comment creation from a user not in the org', async () => {
      const { orgId, projectId, taskId } = await setupOrgProjectTask();

      // Outsider registers but is NOT a member of the org
      const outsiderAgent = createTestAgent();
      await registerUser(outsiderAgent, user3);

      const res = await withCsrf(
        outsiderAgent.post(commentUrl(orgId, projectId, taskId)).send({ body: 'Hacking' }),
      );

      // Should fail at org membership resolution (403)
      expect(res.status).toBe(403);
    });

    it('should reject reading comments from another org', async () => {
      const { ownerAgent, orgId, projectId, taskId } = await setupOrgProjectTask();

      // Add a comment
      await withCsrf(
        ownerAgent.post(commentUrl(orgId, projectId, taskId)).send({ body: 'Secret' }),
      );

      // Register outsider and create their own org
      const outsiderAgent = createTestAgent();
      await registerUser(outsiderAgent, user3);

      const outsiderOrgRes = await withCsrf(
        outsiderAgent.post('/api/v1/orgs').send({ name: 'Outsider Org' }),
      );
      const outsiderOrgId = outsiderOrgRes.body.data.organization.id;

      // Try to read using outsider's org with the real project/task IDs (should fail)
      const res = await outsiderAgent.get(commentUrl(outsiderOrgId, projectId, taskId));
      expect(res.status).toBe(404); // Task not found in outsider's org
    });

    it('should reject editing a comment via wrong org context', async () => {
      const { ownerAgent, orgId, projectId, taskId } = await setupOrgProjectTask();

      const commentRes = await withCsrf(
        ownerAgent.post(commentUrl(orgId, projectId, taskId)).send({ body: 'My comment' }),
      );
      const commentId = commentRes.body.data.comment.id;

      // Create outsider with own org
      const outsiderAgent = createTestAgent();
      await registerUser(outsiderAgent, user3);
      const outsiderOrgRes = await withCsrf(
        outsiderAgent.post('/api/v1/orgs').send({ name: 'Evil Corp' }),
      );
      const evilOrgId = outsiderOrgRes.body.data.organization.id;

      const res = await withCsrf(
        outsiderAgent
          .patch(`${commentUrl(evilOrgId, projectId, taskId)}/${commentId}`)
          .send({ body: 'Hacked!' }),
      );

      expect(res.status).toBe(404);
    });

    it('should reject editing a comment that belongs to a different task', async () => {
      const { ownerAgent, orgId, projectId, taskId } = await setupOrgProjectTask();

      // Create another task
      const task2Res = await withCsrf(
        ownerAgent.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`).send({ title: 'Task 2' }),
      );
      const task2Id = task2Res.body.data.task.id;

      // Create comment on task 2
      const commentRes = await withCsrf(
        ownerAgent.post(commentUrl(orgId, projectId, task2Id)).send({ body: 'Task 2 comment' }),
      );
      const commentId = commentRes.body.data.comment.id;

      // Try to edit via task 1
      const res = await withCsrf(
        ownerAgent
          .patch(`${commentUrl(orgId, projectId, taskId)}/${commentId}`)
          .send({ body: 'Cross-task edit' }),
      );

      expect(res.status).toBe(404); // Comment not found on this task
    });
  });
});
