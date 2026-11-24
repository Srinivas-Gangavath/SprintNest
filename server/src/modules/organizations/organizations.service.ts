import { prisma } from '../../config/database.js';
import { generateSlug } from '../../shared/utils/slug.js';
import { NotFoundError, AuthorizationError } from '../../shared/errors/index.js';
import { createActivityLog } from '../activity/activity.service.js';
import { cache, cacheKeys, cacheTTL } from '../../shared/cache.js';

// ─── Create Organization ────────────────────────────────

export async function createOrganization(userId: string, data: { name: string }) {
  const slug = generateSlug(data.name);

  // Transaction: create org + owner membership + audit log
  const result = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: data.name,
        slug,
        ownerId: userId,
      },
    });

    await tx.orgMember.create({
      data: {
        orgId: org.id,
        userId,
        role: 'OWNER',
      },
    });

    await createActivityLog(tx, {
      orgId: org.id,
      actorId: userId,
      action: 'org.created',
      details: { name: data.name, slug },
    });

    return org;
  });

  // Invalidate: user's org list + new org's member list
  await cache.delete(cacheKeys.userOrgs(userId), cacheKeys.orgMembers(result.id));

  return result;
}

// ─── List User's Organizations ──────────────────────────

export async function listUserOrganizations(userId: string) {
  // Cache-aside: check Redis first
  const cacheKey = cacheKeys.userOrgs(userId);
  const cached = await cache.get<any[]>(cacheKey);
  if (cached) return cached;

  // Cache miss: query database
  const memberships = await prisma.orgMember.findMany({
    where: { userId },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          ownerId: true,
          deletedAt: true,
          createdAt: true,
        },
      },
    },
  });

  // Exclude soft-deleted orgs
  const result = memberships
    .filter((m) => m.organization.deletedAt === null)
    .map((m) => ({
      ...m.organization,
      role: m.role,
    }));

  // Populate cache
  await cache.set(cacheKey, result, cacheTTL.USER_ORGS);

  return result;
}

// ─── Get Organization Details ───────────────────────────

export async function getOrganization(orgId: string) {
  const org = await prisma.organization.findFirst({
    where: { id: orgId, deletedAt: null },
    include: {
      _count: { select: { members: true, projects: true } },
    },
  });

  if (!org) throw new NotFoundError('Organization');

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    ownerId: org.ownerId,
    createdAt: org.createdAt,
    memberCount: org._count.members,
    projectCount: org._count.projects,
  };
}

// ─── Update Organization ────────────────────────────────

export async function updateOrganization(orgId: string, actorId: string, data: { name?: string }) {
  const result = await prisma.$transaction(async (tx) => {
    const updates: Record<string, unknown> = {};
    if (data.name) {
      updates.name = data.name;
      updates.slug = generateSlug(data.name);
    }

    const org = await tx.organization.update({
      where: { id: orgId },
      data: updates,
    });

    await createActivityLog(tx, {
      orgId,
      actorId,
      action: 'org.updated',
      details: updates,
    });

    return org;
  });

  // Invalidate all members' org caches (name/slug changed)
  // We invalidate the actor's cache; other members' caches will expire via TTL
  await cache.delete(cacheKeys.userOrgs(actorId));

  return result;
}

// ─── Soft-Delete Organization ───────────────────────────

export async function softDeleteOrganization(orgId: string, actorId: string) {
  const org = await prisma.organization.findFirst({ where: { id: orgId, deletedAt: null } });
  if (!org) throw new NotFoundError('Organization');

  if (org.ownerId !== actorId) {
    throw new AuthorizationError('Only the organization owner can delete it');
  }

  await prisma.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: orgId },
      data: { deletedAt: new Date() },
    });

    await createActivityLog(tx, {
      orgId,
      actorId,
      action: 'org.deleted',
    });
  });

  // Invalidate: actor's org list + org's member list
  await cache.delete(cacheKeys.userOrgs(actorId), cacheKeys.orgMembers(orgId));
}

