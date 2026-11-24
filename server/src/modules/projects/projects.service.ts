import { prisma } from '../../config/database.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { createActivityLog } from '../activity/activity.service.js';

// ─── Create Project ─────────────────────────────────────

export async function createProject(
  orgId: string,
  actorId: string,
  data: { name: string; description?: string },
) {
  const result = await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        orgId,
        name: data.name,
        description: data.description ?? null,
        createdById: actorId,
      },
    });

    await createActivityLog(tx, {
      orgId,
      actorId,
      projectId: project.id,
      action: 'project.created',
      details: { name: data.name },
    });

    return project;
  });

  return result;
}

// ─── List Projects ──────────────────────────────────────

export async function listProjects(orgId: string, includeArchived: boolean) {
  const where: { orgId: string; isArchived?: boolean } = { orgId };
  if (!includeArchived) {
    where.isArchived = false;
  }

  const projects = await prisma.project.findMany({
    where,
    include: {
      _count: { select: { tasks: true } },
      createdBy: { select: { id: true, displayName: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return projects.map((p) => ({
    id: p.id,
    orgId: p.orgId,
    name: p.name,
    description: p.description,
    isArchived: p.isArchived,
    taskCounter: p.taskCounter,
    taskCount: p._count.tasks,
    createdBy: p.createdBy,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));
}

// ─── Get Project ────────────────────────────────────────

export async function getProject(orgId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
    include: {
      _count: { select: { tasks: true } },
      createdBy: { select: { id: true, displayName: true } },
    },
  });

  if (!project) throw new NotFoundError('Project');

  return {
    id: project.id,
    orgId: project.orgId,
    name: project.name,
    description: project.description,
    isArchived: project.isArchived,
    taskCounter: project.taskCounter,
    taskCount: project._count.tasks,
    createdBy: project.createdBy,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

// ─── Update Project ─────────────────────────────────────

export async function updateProject(
  orgId: string,
  projectId: string,
  actorId: string,
  data: { name?: string; description?: string | null },
) {
  // Verify project belongs to this org
  const existing = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });
  if (!existing) throw new NotFoundError('Project');

  const result = await prisma.$transaction(async (tx) => {
    const updates: Record<string, unknown> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;

    const project = await tx.project.update({
      where: { id: projectId },
      data: updates,
    });

    await createActivityLog(tx, {
      orgId,
      actorId,
      projectId: project.id,
      action: 'project.updated',
      details: updates,
    });

    return project;
  });

  return result;
}

// ─── Archive / Unarchive Project ────────────────────────

export async function archiveProject(
  orgId: string,
  projectId: string,
  actorId: string,
  isArchived: boolean,
) {
  const existing = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });
  if (!existing) throw new NotFoundError('Project');

  const result = await prisma.$transaction(async (tx) => {
    const project = await tx.project.update({
      where: { id: projectId },
      data: { isArchived },
    });

    await createActivityLog(tx, {
      orgId,
      actorId,
      projectId: project.id,
      action: isArchived ? 'project.archived' : 'project.unarchived',
    });

    return project;
  });

  return result;
}
