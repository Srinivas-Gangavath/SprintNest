import { prisma } from '../../config/database.js';
import { NotFoundError, AppError, AuthorizationError } from '../../shared/errors/index.js';
import { createActivityLog } from '../activity/activity.service.js';
import { notificationQueue } from '../../jobs/queues.js';
import {
  emitCommentCreated,
  emitCommentDeleted,
  emitCommentUpdated,
} from '../../websocket/socket.js';
import { logger } from '../../logger.js';

// ─── Verify task belongs to project in org ──────────────

async function verifyTaskInOrg(orgId: string, projectId: string, taskId: string) {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      projectId,
      project: { orgId },
    },
    select: { id: true, projectId: true, project: { select: { orgId: true } } },
  });
  if (!task) throw new NotFoundError('Task');
  return task;
}

// ─── Create Comment ─────────────────────────────────────

export async function createComment(
  orgId: string,
  projectId: string,
  taskId: string,
  actorId: string,
  data: { body: string; parentId?: string },
) {
  await verifyTaskInOrg(orgId, projectId, taskId);

  // Handle parent comment validation
  if (data.parentId) {
    const parent = await prisma.comment.findFirst({
      where: { id: data.parentId, taskId },
      select: { id: true, parentId: true },
    });

    if (!parent) {
      throw new AppError('Parent comment not found on this task', 400);
    }

    // Only allow one level of nesting — parent must be a top-level comment
    if (parent.parentId !== null) {
      throw new AppError('Cannot reply to a reply — only one level of threading is allowed', 400);
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const comment = await tx.comment.create({
      data: {
        taskId,
        authorId: actorId,
        body: data.body,
        parentId: data.parentId ?? null,
      },
      include: {
        author: { select: { id: true, displayName: true, avatarUrl: true } },
      },
    });

    await createActivityLog(tx, {
      orgId,
      actorId,
      projectId,
      taskId,
      action: 'comment.created',
      details: { commentId: comment.id },
    });

    return comment;
  });

  const formatted = formatComment(result);

  // Enqueue notification for the task's assignee (if different from comment author)
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        title: true,
        assigneeId: true,
        project: { select: { id: true, name: true } },
      },
    });
    if (task && task.assigneeId && task.assigneeId !== actorId) {
      await notificationQueue.add('fan-out-notification', {
        type: 'comment_added',
        recipientId: task.assigneeId,
        title: `New comment on "${task.title}"`,
        dedupeKey: `comment_added:${result.id}:${task.assigneeId}`,
        data: {
          commentId: result.id,
          taskId,
          projectId: task.project.id,
          orgId,
          taskTitle: task.title,
          commenterName: result.author.displayName,
        },
      });
    }
  } catch (err) {
    logger.error({ err, commentId: result.id }, 'Failed to enqueue comment notification');
  }

  emitCommentCreated({ orgId, projectId, taskId, comment: formatted });

  return formatted;
}

// ─── List Comments ──────────────────────────────────────

export async function listComments(
  orgId: string,
  projectId: string,
  taskId: string,
) {
  await verifyTaskInOrg(orgId, projectId, taskId);

  // Fetch all top-level comments with their replies
  const comments = await prisma.comment.findMany({
    where: { taskId, parentId: null },
    include: {
      author: { select: { id: true, displayName: true, avatarUrl: true } },
      replies: {
        include: {
          author: { select: { id: true, displayName: true, avatarUrl: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return comments.map((c) => ({
    ...formatComment(c),
    replies: (c.replies || []).map(formatComment),
  }));
}

// ─── Update Comment ─────────────────────────────────────

export async function updateComment(
  orgId: string,
  projectId: string,
  taskId: string,
  commentId: string,
  actorId: string,
  actorRole: string,
  data: { body: string },
) {
  await verifyTaskInOrg(orgId, projectId, taskId);

  const existing = await prisma.comment.findFirst({
    where: { id: commentId, taskId },
    select: { id: true, authorId: true },
  });

  if (!existing) throw new NotFoundError('Comment');

  // Authorization: author can edit their own, or OWNER/ADMIN can moderate
  if (existing.authorId !== actorId && actorRole !== 'OWNER' && actorRole !== 'ADMIN') {
    throw new AuthorizationError('You can only edit your own comments');
  }

  const result = await prisma.$transaction(async (tx) => {
    const comment = await tx.comment.update({
      where: { id: commentId },
      data: {
        body: data.body,
        isEdited: true,
      },
      include: {
        author: { select: { id: true, displayName: true, avatarUrl: true } },
      },
    });

    await createActivityLog(tx, {
      orgId,
      actorId,
      projectId,
      taskId,
      action: 'comment.updated',
      details: { commentId },
    });

    return comment;
  });

  const comment = formatComment(result);
  emitCommentUpdated({ orgId, projectId, taskId, comment });

  return comment;
}

// ─── Delete Comment ─────────────────────────────────────

export async function deleteComment(
  orgId: string,
  projectId: string,
  taskId: string,
  commentId: string,
  actorId: string,
  actorRole: string,
) {
  await verifyTaskInOrg(orgId, projectId, taskId);

  const existing = await prisma.comment.findFirst({
    where: { id: commentId, taskId },
    select: { id: true, authorId: true },
  });

  if (!existing) throw new NotFoundError('Comment');

  // Authorization: author can delete their own, or OWNER/ADMIN can moderate
  if (existing.authorId !== actorId && actorRole !== 'OWNER' && actorRole !== 'ADMIN') {
    throw new AuthorizationError('You can only delete your own comments');
  }

  await prisma.$transaction(async (tx) => {
    // Delete replies first (cascade should handle it, but let's be explicit)
    await tx.comment.deleteMany({ where: { parentId: commentId } });
    await tx.comment.delete({ where: { id: commentId } });

    await createActivityLog(tx, {
      orgId,
      actorId,
      projectId,
      taskId,
      action: 'comment.deleted',
      details: { commentId },
    });
  });

  emitCommentDeleted({ orgId, projectId, taskId, commentId });
}

// ─── Format Helper ──────────────────────────────────────

function formatComment(comment: any) {
  return {
    id: comment.id,
    taskId: comment.taskId,
    body: comment.body,
    parentId: comment.parentId,
    isEdited: comment.isEdited,
    author: comment.author,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
}
