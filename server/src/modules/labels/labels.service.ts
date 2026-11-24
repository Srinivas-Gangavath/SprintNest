import { prisma } from '../../config/database.js';
import { NotFoundError, ConflictError } from '../../shared/errors/index.js';
import { createActivityLog } from '../activity/activity.service.js';

// ─── Create Label ───────────────────────────────────────

export async function createLabel(
  orgId: string,
  actorId: string,
  data: { name: string; color?: string },
) {
  // Check uniqueness within org
  const existing = await prisma.label.findFirst({
    where: { orgId, name: data.name },
  });
  if (existing) {
    throw new ConflictError(`Label "${data.name}" already exists in this organization`);
  }

  const result = await prisma.$transaction(async (tx) => {
    const label = await tx.label.create({
      data: {
        orgId,
        name: data.name,
        color: data.color ?? '#6B7280',
      },
    });

    await createActivityLog(tx, {
      orgId,
      actorId,
      action: 'label.created',
      details: { name: data.name, color: label.color },
    });

    return label;
  });

  return result;
}

// ─── List Labels ────────────────────────────────────────

export async function listLabels(orgId: string) {
  return prisma.label.findMany({
    where: { orgId },
    orderBy: { name: 'asc' },
  });
}

// ─── Update Label ───────────────────────────────────────

export async function updateLabel(
  orgId: string,
  labelId: string,
  actorId: string,
  data: { name?: string; color?: string },
) {
  const existing = await prisma.label.findFirst({
    where: { id: labelId, orgId },
  });
  if (!existing) throw new NotFoundError('Label');

  // Check name uniqueness if name is being changed
  if (data.name && data.name !== existing.name) {
    const duplicate = await prisma.label.findFirst({
      where: { orgId, name: data.name, id: { not: labelId } },
    });
    if (duplicate) {
      throw new ConflictError(`Label "${data.name}" already exists in this organization`);
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const updates: Record<string, unknown> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.color !== undefined) updates.color = data.color;

    const label = await tx.label.update({
      where: { id: labelId },
      data: updates,
    });

    await createActivityLog(tx, {
      orgId,
      actorId,
      action: 'label.updated',
      details: updates,
    });

    return label;
  });

  return result;
}

// ─── Delete Label ───────────────────────────────────────

export async function deleteLabel(
  orgId: string,
  labelId: string,
  actorId: string,
) {
  const existing = await prisma.label.findFirst({
    where: { id: labelId, orgId },
  });
  if (!existing) throw new NotFoundError('Label');

  await prisma.$transaction(async (tx) => {
    // task_labels cascade-deletes are handled by Prisma schema onDelete: Cascade
    await tx.label.delete({ where: { id: labelId } });

    await createActivityLog(tx, {
      orgId,
      actorId,
      action: 'label.deleted',
      details: { name: existing.name },
    });
  });
}
