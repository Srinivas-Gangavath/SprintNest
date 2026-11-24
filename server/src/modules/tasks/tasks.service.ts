import type { Prisma, TaskStatus, TaskPriority } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { NotFoundError, AppError } from '../../shared/errors/index.js';
import { createActivityLog } from '../activity/activity.service.js';
import { cache, cacheKeys, cacheTTL } from '../../shared/cache.js';
import { notificationQueue } from '../../jobs/queues.js';
import { emitTaskCreated, emitTaskDeleted, emitTaskUpdated } from '../../websocket/socket.js';
import { logger } from '../../logger.js';

// ─── Verify project belongs to org ──────────────────────

async function verifyProjectInOrg(orgId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });
  if (!project) throw new NotFoundError('Project');
  return project;
}

// ─── Validate assignee is an org member ─────────────────

async function validateAssignee(orgId: string, assigneeId: string) {
  const member = await prisma.orgMember.findFirst({
    where: { orgId, userId: assigneeId },
  });
  if (!member) {
    throw new AppError('Assignee must be a member of this organization', 400);
  }
}

// ─── Create Task ────────────────────────────────────────

export async function createTask(
  orgId: string,
  projectId: string,
  actorId: string,
  data: {
    title: string;
    description?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    assigneeId?: string | null;
    dueDate?: string | null;
    labelIds?: string[];
  },
) {
  await verifyProjectInOrg(orgId, projectId);

  // Validate assignee if provided
  if (data.assigneeId) {
    await validateAssignee(orgId, data.assigneeId);
  }

  const result = await prisma.$transaction(async (tx) => {
    // Atomically increment taskCounter and create the task
    const updatedProject = await tx.project.update({
      where: { id: projectId },
      data: { taskCounter: { increment: 1 } },
      select: { taskCounter: true },
    });

    const taskData: Prisma.TaskCreateInput = {
      project: { connect: { id: projectId } },
      taskNumber: updatedProject.taskCounter,
      title: data.title,
      description: data.description ?? null,
      status: data.status ?? 'BACKLOG',
      priority: data.priority ?? 'NONE',
      createdBy: { connect: { id: actorId } },
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
    };

    if (data.assigneeId) {
      taskData.assignee = { connect: { id: data.assigneeId } };
    }

    // Set completedAt if status is DONE
    if (data.status === 'DONE') {
      taskData.completedAt = new Date();
    }

    const task = await tx.task.create({
      data: taskData,
      include: {
        assignee: { select: { id: true, displayName: true, email: true } },
        createdBy: { select: { id: true, displayName: true } },
        labels: { include: { label: true } },
      },
    });

    // Attach labels if provided
    if (data.labelIds && data.labelIds.length > 0) {
      // Verify all labels belong to this org
      const validLabels = await tx.label.findMany({
        where: { id: { in: data.labelIds }, orgId },
        select: { id: true },
      });
      const validLabelIds = validLabels.map((l) => l.id);

      if (validLabelIds.length > 0) {
        await tx.taskLabel.createMany({
          data: validLabelIds.map((labelId) => ({
            taskId: task.id,
            labelId,
          })),
        });
      }
    }

    await createActivityLog(tx, {
      orgId,
      actorId,
      projectId,
      taskId: task.id,
      action: 'task.created',
      details: { title: data.title, taskNumber: updatedProject.taskCounter },
    });

    // Re-fetch to include labels
    if (data.labelIds && data.labelIds.length > 0) {
      return tx.task.findUniqueOrThrow({
        where: { id: task.id },
        include: {
          assignee: { select: { id: true, displayName: true, email: true } },
          createdBy: { select: { id: true, displayName: true } },
          labels: { include: { label: true } },
        },
      });
    }

    return task;
  });

  // Invalidate task-stats cache for this project
  await cache.delete(cacheKeys.projectTaskStats(projectId));

  // Enqueue notification if task is assigned to someone other than the actor
  if (data.assigneeId && data.assigneeId !== actorId) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { displayName: true } });
    try {
      await notificationQueue.add('fan-out-notification', {
        type: 'task_assigned',
        recipientId: data.assigneeId,
        title: `You were assigned to "${data.title}"`,
        dedupeKey: `task_assigned:${result.id}:${data.assigneeId}`,
        data: {
          taskId: result.id,
          projectId,
          orgId,
          taskTitle: data.title,
          projectName: project?.name ?? '',
          assignedByName: actor?.displayName ?? '',
        },
      });
    } catch (err) {
      logger.error({ err, taskId: result.id }, 'Failed to enqueue task-assigned notification');
    }
  }

  const task = formatTask(result);
  emitTaskCreated({ orgId, projectId, task });

  return task;
}

// ─── List Tasks ─────────────────────────────────────────

export async function listTasks(
  orgId: string,
  projectId: string,
  filters: {
    status?: TaskStatus;
    priority?: TaskPriority;
    assigneeId?: string;
    labelId?: string;
    page: number;
    limit: number;
  },
) {
  await verifyProjectInOrg(orgId, projectId);

  const where: Prisma.TaskWhereInput = { projectId };

  if (filters.status) where.status = filters.status;
  if (filters.priority) where.priority = filters.priority;
  if (filters.assigneeId) where.assigneeId = filters.assigneeId;
  if (filters.labelId) {
    where.labels = { some: { labelId: filters.labelId } };
  }

  const skip = (filters.page - 1) * filters.limit;

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: {
        assignee: { select: { id: true, displayName: true, email: true } },
        createdBy: { select: { id: true, displayName: true } },
        labels: { include: { label: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: filters.limit,
    }),
    prisma.task.count({ where }),
  ]);

  return {
    tasks: tasks.map(formatTask),
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages: Math.ceil(total / filters.limit),
    },
  };
}

// ─── Get Task ───────────────────────────────────────────

export async function getTask(orgId: string, projectId: string, taskId: string) {
  await verifyProjectInOrg(orgId, projectId);

  const task = await prisma.task.findFirst({
    where: { id: taskId, projectId },
    include: {
      assignee: { select: { id: true, displayName: true, email: true } },
      createdBy: { select: { id: true, displayName: true } },
      labels: { include: { label: true } },
    },
  });

  if (!task) throw new NotFoundError('Task');

  return formatTask(task);
}

// ─── Update Task ────────────────────────────────────────

export async function updateTask(
  orgId: string,
  projectId: string,
  taskId: string,
  actorId: string,
  data: {
    title?: string;
    description?: string | null;
    status?: TaskStatus;
    priority?: TaskPriority;
    assigneeId?: string | null;
    dueDate?: string | null;
    labelIds?: string[];
  },
) {
  await verifyProjectInOrg(orgId, projectId);

  const existing = await prisma.task.findFirst({
    where: { id: taskId, projectId },
  });
  if (!existing) throw new NotFoundError('Task');

  // Validate assignee if being set
  if (data.assigneeId) {
    await validateAssignee(orgId, data.assigneeId);
  }

  const result = await prisma.$transaction(async (tx) => {
    const updateData: Prisma.TaskUpdateInput = {};

    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.dueDate !== undefined) {
      updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
    }

    // Handle assignee
    if (data.assigneeId !== undefined) {
      if (data.assigneeId === null) {
        updateData.assignee = { disconnect: true };
      } else {
        updateData.assignee = { connect: { id: data.assigneeId } };
      }
    }

    // Handle status changes — set/clear completedAt
    if (data.status !== undefined) {
      updateData.status = data.status;
      if (data.status === 'DONE' && existing.status !== 'DONE') {
        updateData.completedAt = new Date();
      } else if (data.status !== 'DONE' && existing.status === 'DONE') {
        updateData.completedAt = null;
      }
    }

    const task = await tx.task.update({
      where: { id: taskId },
      data: updateData,
      include: {
        assignee: { select: { id: true, displayName: true, email: true } },
        createdBy: { select: { id: true, displayName: true } },
        labels: { include: { label: true } },
      },
    });

    // Handle labels — replace if provided
    if (data.labelIds !== undefined) {
      // Remove existing labels
      await tx.taskLabel.deleteMany({ where: { taskId } });

      if (data.labelIds.length > 0) {
        // Verify all labels belong to this org
        const validLabels = await tx.label.findMany({
          where: { id: { in: data.labelIds }, orgId },
          select: { id: true },
        });

        if (validLabels.length > 0) {
          await tx.taskLabel.createMany({
            data: validLabels.map((l) => ({
              taskId,
              labelId: l.id,
            })),
          });
        }
      }
    }

    const changes: Record<string, unknown> = {};
    if (data.title !== undefined) changes.title = data.title;
    if (data.status !== undefined) changes.status = data.status;
    if (data.priority !== undefined) changes.priority = data.priority;
    if (data.assigneeId !== undefined) changes.assigneeId = data.assigneeId;

    await createActivityLog(tx, {
      orgId,
      actorId,
      projectId,
      taskId: task.id,
      action: 'task.updated',
      details: changes,
    });

    // Re-fetch to get updated labels
    if (data.labelIds !== undefined) {
      return tx.task.findUniqueOrThrow({
        where: { id: taskId },
        include: {
          assignee: { select: { id: true, displayName: true, email: true } },
          createdBy: { select: { id: true, displayName: true } },
          labels: { include: { label: true } },
        },
      });
    }

    return task;
  });

  // Invalidate task-stats cache for this project
  await cache.delete(cacheKeys.projectTaskStats(projectId));

  // Enqueue notification when the task is (re)assigned to someone other than the actor
  // and different from the previous assignee (to avoid duplicate notifications)
  if (
    data.assigneeId &&
    data.assigneeId !== actorId &&
    data.assigneeId !== existing.assigneeId
  ) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { displayName: true } });
    try {
      await notificationQueue.add('fan-out-notification', {
        type: 'task_assigned',
        recipientId: data.assigneeId,
        title: `You were assigned to "${result.title}"`,
        dedupeKey: `task_assigned:${taskId}:${data.assigneeId}:${result.updatedAt.getTime()}`,
        data: {
          taskId: taskId,
          projectId,
          orgId,
          taskTitle: result.title,
          projectName: project?.name ?? '',
          assignedByName: actor?.displayName ?? '',
        },
      });
    } catch (err) {
      logger.error({ err, taskId }, 'Failed to enqueue task-assigned notification on update');
    }
  }

  const task = formatTask(result);
  emitTaskUpdated({ orgId, projectId, task });

  return task;
}

// ─── Delete Task ────────────────────────────────────────

export async function deleteTask(
  orgId: string,
  projectId: string,
  taskId: string,
  actorId: string,
) {
  await verifyProjectInOrg(orgId, projectId);

  const existing = await prisma.task.findFirst({
    where: { id: taskId, projectId },
  });
  if (!existing) throw new NotFoundError('Task');

  await prisma.$transaction(async (tx) => {
    await tx.task.delete({ where: { id: taskId } });

    await createActivityLog(tx, {
      orgId,
      actorId,
      projectId,
      action: 'task.deleted',
      details: { title: existing.title, taskNumber: existing.taskNumber },
    });
  });

  // Invalidate task-stats cache for this project
  await cache.delete(cacheKeys.projectTaskStats(projectId));

  emitTaskDeleted({ orgId, projectId, taskId });
}

// ─── Format Helper ──────────────────────────────────────

function formatTask(task: any) {
  return {
    id: task.id,
    projectId: task.projectId,
    taskNumber: task.taskNumber,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assignee: task.assignee,
    createdBy: task.createdBy,
    dueDate: task.dueDate,
    completedAt: task.completedAt,
    labels: task.labels?.map((tl: any) => tl.label) ?? [],
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

// ─── Task Statistics (cached) ────────────────────────

export async function getTaskStats(orgId: string, projectId: string) {
  await verifyProjectInOrg(orgId, projectId);

  // Cache-aside: check Redis first
  const key = cacheKeys.projectTaskStats(projectId);
  const cached = await cache.get<Record<string, number>>(key);
  if (cached) return cached;

  // Cache miss: aggregate from database
  const counts = await prisma.task.groupBy({
    by: ['status'],
    where: { projectId },
    _count: { status: true },
  });

  const stats: Record<string, number> = {
    BACKLOG: 0,
    TODO: 0,
    IN_PROGRESS: 0,
    IN_REVIEW: 0,
    DONE: 0,
  };

  for (const row of counts) {
    stats[row.status] = row._count.status;
  }

  // Populate cache
  await cache.set(key, stats, cacheTTL.TASK_STATS);

  return stats;
}

// ─── Tasks assigned to the current member ───────────

const TASK_STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const;

/**
 * Lists tasks assigned to `userId` inside this organization only.
 * The assignee is always the caller — the query cannot ask for someone else.
 */
export async function listMyTasks(
  orgId: string,
  userId: string,
  filters: {
    status?: TaskStatus;
    priority?: TaskPriority;
    page: number;
    limit: number;
  },
) {
  const assignedHere: Prisma.TaskWhereInput = {
    assigneeId: userId,
    project: { orgId },
  };
  const where: Prisma.TaskWhereInput = { ...assignedHere };
  if (filters.status) where.status = filters.status;
  if (filters.priority) where.priority = filters.priority;

  const skip = (filters.page - 1) * filters.limit;

  const [tasks, total, counts] = await Promise.all([
    prisma.task.findMany({
      where,
      include: {
        project: { select: { id: true, name: true } },
        assignee: { select: { id: true, displayName: true, email: true } },
        createdBy: { select: { id: true, displayName: true } },
        labels: { include: { label: true } },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip,
      take: filters.limit,
    }),
    prisma.task.count({ where }),
    prisma.task.groupBy({
      by: ['status'],
      where: assignedHere,
      _count: { _all: true },
    }),
  ]);

  const summary: Record<(typeof TASK_STATUSES)[number], number> = {
    BACKLOG: 0,
    TODO: 0,
    IN_PROGRESS: 0,
    IN_REVIEW: 0,
    DONE: 0,
  };
  for (const row of counts) {
    summary[row.status] = row._count._all;
  }

  return {
    tasks: tasks.map((task) => ({
      ...formatTask(task),
      project: task.project,
    })),
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages: Math.ceil(total / filters.limit),
    },
    summary: {
      ...summary,
      total: TASK_STATUSES.reduce((sum, status) => sum + summary[status], 0),
    },
  };
}
