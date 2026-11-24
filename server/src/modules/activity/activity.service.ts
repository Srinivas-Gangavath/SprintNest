import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../config/database.js';

type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface ActivityLogInput {
  orgId: string;
  actorId: string;
  action: string;
  projectId?: string;
  taskId?: string;
  details?: Record<string, unknown>;
}

/**
 * Create an activity log entry inside an existing Prisma transaction.
 * This ensures the audit trail is consistent with the mutation — if the
 * transaction rolls back, the log entry rolls back too.
 */
export async function createActivityLog(tx: TxClient, input: ActivityLogInput) {
  return tx.activityLog.create({
    data: {
      orgId: input.orgId,
      actorId: input.actorId,
      action: input.action,
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      details: (input.details as Prisma.JsonObject) ?? undefined,
    },
  });
}

const DETAIL_TEXT_KEYS = ['name', 'email', 'role', 'title', 'status', 'priority', 'oldRole', 'newRole'] as const;

/** Copies only short display strings. Tokens, ids, and unknown keys are dropped. */
function readDetails(details: unknown): Record<string, string> {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
  const source = details as Record<string, unknown>;
  const safe: Record<string, string> = {};
  for (const key of DETAIL_TEXT_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0 && value.length <= 255) {
      safe[key] = value;
    }
  }
  return safe;
}

function describeAction(action: string, details: Record<string, string>): string {
  switch (action) {
    case 'org.created':
      return 'created the workspace';
    case 'org.updated':
      return details.name ? `renamed the workspace to ${details.name}` : 'updated the workspace';
    case 'org.deleted':
      return 'deleted the workspace';
    case 'project.created':
      return details.name ? `created project ${details.name}` : 'created a project';
    case 'project.updated':
      return details.name ? `updated project ${details.name}` : 'updated a project';
    case 'project.archived':
      return 'archived a project';
    case 'project.unarchived':
      return 'restored a project';
    case 'member.invited':
      return `invited ${details.email ?? 'someone'}${details.role ? ` as ${details.role}` : ''}`;
    case 'member.joined':
      return 'joined the workspace';
    case 'invitation.resent':
      return `resent an invitation${details.email ? ` to ${details.email}` : ''}`;
    case 'invitation.cancelled':
      return `cancelled an invitation${details.email ? ` to ${details.email}` : ''}`;
    case 'member.role_changed':
      return details.oldRole && details.newRole
        ? `changed a member role from ${details.oldRole} to ${details.newRole}`
        : 'changed a member role';
    case 'member.removed':
      return details.role ? `removed a ${details.role}` : 'removed a member';
    case 'task.created':
      return details.title ? `created task ${details.title}` : 'created a task';
    case 'task.updated':
      return details.title ? `updated task ${details.title}` : 'updated a task';
    case 'task.deleted':
      return details.title ? `deleted task ${details.title}` : 'deleted a task';
    case 'comment.created':
      return 'commented on a task';
    case 'comment.updated':
      return 'edited a comment';
    case 'comment.deleted':
      return 'deleted a comment';
    case 'label.created':
      return details.name ? `created label ${details.name}` : 'created a label';
    case 'label.updated':
      return details.name ? `updated label ${details.name}` : 'updated a label';
    case 'label.deleted':
      return details.name ? `deleted label ${details.name}` : 'deleted a label';
    default:
      return action.replace(/\./g, ' ');
  }
}

/**
 * Audit log for one organization. Caller must already be an owner or admin
 * of `orgId`. Rows are filtered by that id only.
 */
export async function listActivity(orgId: string, page: number, limit: number) {
  const where = { orgId };
  const skip = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      include: {
        actor: { select: { id: true, displayName: true } },
        project: { select: { id: true, name: true } },
        task: { select: { id: true, title: true, taskNumber: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take: limit,
    }),
    prisma.activityLog.count({ where }),
  ]);

  return {
    activities: rows.map((row) => ({
      id: row.id,
      orgId: row.orgId,
      action: row.action,
      summary: describeAction(row.action, readDetails(row.details)),
      createdAt: row.createdAt,
      actor: row.actor,
      project: row.project,
      task: row.task,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}
