import bcrypt from 'bcryptjs';
import type { OrgRole, Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { generateToken, hashToken } from '../../shared/utils/hash.js';
import { AuthorizationError, ConflictError, NotFoundError, AppError } from '../../shared/errors/index.js';
import { INVITATION_TTL_DAYS } from '../../shared/constants.js';
import { createActivityLog } from '../activity/activity.service.js';
import { emailQueue, notificationQueue } from '../../jobs/queues.js';
import { config } from '../../config/index.js';
import { cache, cacheKeys, cacheTTL } from '../../shared/cache.js';
import { emitMemberAdded, emitMemberRemoved } from '../../websocket/socket.js';
import { logger } from '../../logger.js';

const BCRYPT_ROUNDS = 12;

type InvitationWithOrg = Prisma.OrgInvitationGetPayload<{
  include: {
    organization: {
      select: { id: true; name: true; slug: true; ownerId: true; createdAt: true; deletedAt: true };
    };
    invitedBy: { select: { displayName: true } };
  };
}>;

// ─── List Members ───────────────────────────────────────

export async function listMembers(orgId: string) {
  // Cache-aside: check Redis first
  const cacheKey = cacheKeys.orgMembers(orgId);
  const cached = await cache.get<any[]>(cacheKey);
  if (cached) return cached;

  // Cache miss: query database
  const members = await prisma.orgMember.findMany({
    where: { orgId },
    include: {
      user: {
        select: { id: true, email: true, displayName: true, avatarUrl: true },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });

  const result = members.map((m) => ({
    id: m.id,
    userId: m.userId,
    role: m.role,
    joinedAt: m.joinedAt,
    user: m.user,
  }));

  // Populate cache
  await cache.set(cacheKey, result, cacheTTL.ORG_MEMBERS);

  return result;
}

// ─── Invite Member ──────────────────────────────────────

export async function inviteMember(
  orgId: string,
  actorId: string,
  data: { email: string; role: 'ADMIN' | 'MEMBER' },
) {
  const email = data.email.toLowerCase().trim();

  // Check if user is already a member
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    const existingMember = await prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId: existingUser.id } },
    });
    if (existingMember) {
      throw new ConflictError('This user is already a member of the organization');
    }
  }

  // Check for existing pending invitation
  const existingInvitation = await prisma.orgInvitation.findFirst({
    where: { orgId, email, status: 'PENDING' },
  });
  if (existingInvitation) {
    throw new ConflictError('A pending invitation already exists for this email');
  }

  const rawToken = generateToken(32);
  const tokenHash = hashToken(rawToken);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITATION_TTL_DAYS);

  const invitation = await prisma.$transaction(async (tx) => {
    const inv = await tx.orgInvitation.create({
      data: {
        orgId,
        email,
        role: data.role,
        invitedById: actorId,
        tokenHash,
        expiresAt,
      },
    });

    await createActivityLog(tx, {
      orgId,
      actorId,
      action: 'member.invited',
      details: { email, role: data.role },
    });

    return inv;
  });

  // Enqueue invitation email via BullMQ.
  // Tradeoff: if queue submission fails, the invitation exists in the DB but the email
  // won't be sent. The admin can see the pending invitation and resend it.
  // We don't roll back the invitation because the DB record is the source of truth.
  await queueInvitationEmail({
    orgId,
    actorId,
    email,
    rawToken,
    role: data.role,
    invitationId: invitation.id,
    existingUserId: existingUser?.id ?? null,
    notifyExistingUser: true,
  });

  return { id: invitation.id, email, role: data.role, status: invitation.status };
}

async function queueInvitationEmail(params: {
  orgId: string;
  actorId: string;
  email: string;
  rawToken: string;
  role: string;
  invitationId: string;
  existingUserId: string | null;
  notifyExistingUser: boolean;
}): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { id: params.orgId } });
  const actor = await prisma.user.findUnique({ where: { id: params.actorId } });
  if (!org || !actor) return;

  try {
    await emailQueue.add('send-invitation-email', {
      to: params.email,
      orgName: org.name,
      inviterName: actor.displayName,
      rawToken: params.rawToken, // needed to construct accept URL — never logged
    });
  } catch (err) {
    logger.error({ err, orgId: params.orgId, email: params.email }, 'Failed to enqueue invitation email job');
  }

  if (!params.notifyExistingUser || !params.existingUserId) return;

  try {
    await notificationQueue.add('fan-out-notification', {
      type: 'invitation_received',
      recipientId: params.existingUserId,
      title: `You've been invited to join ${org.name}`,
      dedupeKey: `invitation_received:${params.invitationId}:${params.existingUserId}`,
      data: {
        invitationId: params.invitationId,
        orgId: params.orgId,
        orgName: org.name,
        invitedByName: actor.displayName,
        role: params.role,
      },
    });
  } catch (err) {
    logger.error(
      { err, orgId: params.orgId, userId: params.existingUserId },
      'Failed to enqueue invitation notification job',
    );
  }
}

async function findInvitationByRawToken(rawToken: string): Promise<InvitationWithOrg | null> {
  return prisma.orgInvitation.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: {
      organization: {
        select: { id: true, name: true, slug: true, ownerId: true, createdAt: true, deletedAt: true },
      },
      invitedBy: { select: { displayName: true } },
    },
  });
}

function assertOrganizationAvailable(invitation: InvitationWithOrg): void {
  if (!invitation.organization || invitation.organization.deletedAt !== null) {
    throw new AppError('This organization is no longer available', 400);
  }
}

/** Marks a still-pending invitation expired. Returns true when it was expired. */
async function expireInvitationIfNeeded(invitation: { id: string; status: string; expiresAt: Date }): Promise<boolean> {
  if (invitation.status === 'PENDING' && invitation.expiresAt < new Date()) {
    await prisma.orgInvitation.update({
      where: { id: invitation.id },
      data: { status: 'EXPIRED' },
    });
    return true;
  }
  return false;
}

/**
 * Creates the membership for a pending invitation inside the caller's transaction.
 * Conditional status update so a second acceptance cannot create another membership.
 */
async function grantInvitationMembership(
  tx: Prisma.TransactionClient,
  invitation: { id: string; orgId: string; role: OrgRole },
  userId: string,
): Promise<Exclude<OrgRole, 'OWNER'>> {
  const grantedRole = invitation.role === 'OWNER' ? 'MEMBER' : invitation.role;

  const updated = await tx.orgInvitation.updateMany({
    where: { id: invitation.id, status: 'PENDING' },
    data: { status: 'ACCEPTED' },
  });
  if (updated.count !== 1) {
    throw new AppError('Invalid or already used invitation', 400);
  }

  await tx.orgMember.create({
    data: {
      orgId: invitation.orgId,
      userId,
      role: grantedRole,
    },
  });

  await createActivityLog(tx, {
    orgId: invitation.orgId,
    actorId: userId,
    action: 'member.joined',
    details: { role: invitation.role },
  });

  return grantedRole;
}

function toJoinedOrganization(
  invitation: InvitationWithOrg,
  grantedRole: Exclude<OrgRole, 'OWNER'>,
) {
  return {
    id: invitation.organization.id,
    name: invitation.organization.name,
    slug: invitation.organization.slug,
    ownerId: invitation.organization.ownerId,
    createdAt: invitation.organization.createdAt,
    role: grantedRole,
  };
}

// ─── Accept Invitation ──────────────────────────────────

export async function acceptInvitation(rawToken: string, userId: string, userEmail: string) {
  const invitation = await findInvitationByRawToken(rawToken);

  if (!invitation) {
    throw new AppError('Invalid or already used invitation', 400);
  }

  // A soft-deleted workspace must not gain new members through a stale invite.
  assertOrganizationAvailable(invitation);

  const emailMatches = invitation.email.toLowerCase() === userEmail.toLowerCase();

  // The intended recipient who is already in the org (including a second click
  // of an already-accepted link) gets a dedicated conflict, not a generic 400.
  const existingMember = await prisma.orgMember.findUnique({
    where: { orgId_userId: { orgId: invitation.orgId, userId } },
  });
  if (emailMatches && existingMember) {
    if (invitation.status === 'PENDING') {
      await prisma.orgInvitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED' },
      });
    }
    throw new ConflictError('You are already a member of this organization');
  }

  if (invitation.status !== 'PENDING') {
    throw new AppError('Invalid or already used invitation', 400);
  }

  // Lazy expiration check
  if (await expireInvitationIfNeeded(invitation)) {
    throw new AppError('This invitation has expired', 400);
  }

  // Verify the invitation email matches the authenticated user
  if (!emailMatches) {
    throw new AuthorizationError('This invitation was sent to a different email address');
  }

  const grantedRole = await prisma.$transaction((tx) =>
    grantInvitationMembership(tx, invitation, userId),
  );

  // Invalidate: user's org list + org's member list
  await cache.delete(cacheKeys.userOrgs(userId), cacheKeys.orgMembers(invitation.orgId));

  await emitMemberAdded({ orgId: invitation.orgId, userId, role: grantedRole });

  // Returned so the client can drop the user straight into the joined workspace.
  // Never includes the invitation token or its hash.
  return { organization: toJoinedOrganization(invitation, grantedRole) };
}

// ─── Decline Invitation ─────────────────────────────────

export async function declineInvitation(rawToken: string, userId: string, userEmail: string) {
  const tokenHash = hashToken(rawToken);
  const invitation = await prisma.orgInvitation.findUnique({ where: { tokenHash } });

  if (!invitation || invitation.status !== 'PENDING') {
    throw new AppError('Invalid or already used invitation', 400);
  }

  if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
    throw new AuthorizationError('This invitation was sent to a different email address');
  }

  await prisma.orgInvitation.update({
    where: { id: invitation.id },
    data: { status: 'DECLINED' },
  });
}

// ─── List Pending Invitations for User ──────────────────

export async function listPendingInvitations(userEmail: string) {
  // Explicit select: the row also holds `tokenHash`, which must never leave the
  // server. The raw token only ever exists in the emailed acceptance link.
  return prisma.orgInvitation.findMany({
    where: {
      email: userEmail.toLowerCase(),
      status: 'PENDING',
      expiresAt: { gt: new Date() },
      organization: { deletedAt: null },
    },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      expiresAt: true,
      organization: { select: { id: true, name: true, slug: true } },
      invitedBy: { select: { displayName: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

// ─── Public invitation preview (token holder) ───────────

/**
 * Safe view of an invitation for the person holding the emailed link.
 * Reveals the invited address so the registration form can lock it, and whether
 * that address already has an account. Never returns the token or its hash.
 */
export async function previewInvitation(rawToken: string) {
  const invitation = await findInvitationByRawToken(rawToken);
  if (!invitation) {
    throw new AppError('Invalid or already used invitation', 400);
  }
  assertOrganizationAvailable(invitation);

  let status = invitation.status;
  if (await expireInvitationIfNeeded(invitation)) {
    status = 'EXPIRED';
  }

  const account = await prisma.user.findUnique({
    where: { email: invitation.email.toLowerCase() },
    select: { id: true },
  });

  return {
    email: invitation.email,
    role: invitation.role === 'OWNER' ? 'MEMBER' : invitation.role,
    status,
    accountExists: Boolean(account),
    expiresAt: invitation.expiresAt,
    organization: {
      id: invitation.organization.id,
      name: invitation.organization.name,
      slug: invitation.organization.slug,
    },
    invitedBy: { displayName: invitation.invitedBy.displayName },
  };
}

// ─── Register from invitation ───────────────────────────

/**
 * Creates the invited account and accepts the invitation in one transaction.
 * The account email is always the invitation's email — a client-supplied email
 * that differs is rejected and never used.
 */
export async function registerAndAcceptInvitation(
  rawToken: string,
  data: { displayName: string; password: string; email?: string },
) {
  const invitation = await findInvitationByRawToken(rawToken);
  if (!invitation) {
    throw new AppError('Invalid or already used invitation', 400);
  }
  assertOrganizationAvailable(invitation);

  if (invitation.status !== 'PENDING') {
    throw new AppError('Invalid or already used invitation', 400);
  }

  if (await expireInvitationIfNeeded(invitation)) {
    throw new AppError('This invitation has expired', 400);
  }

  if (data.email && data.email.toLowerCase().trim() !== invitation.email.toLowerCase()) {
    throw new AppError('The invitation email cannot be changed', 400);
  }

  const existing = await prisma.user.findUnique({ where: { email: invitation.email } });
  if (existing) {
    throw new ConflictError('An account with this email already exists. Sign in to accept this invitation.');
  }

  const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: invitation.email,
        passwordHash,
        displayName: data.displayName.trim(),
      },
    });
    const grantedRole = await grantInvitationMembership(tx, invitation, user.id);
    return { user, grantedRole };
  });

  await cache.delete(cacheKeys.userOrgs(created.user.id), cacheKeys.orgMembers(invitation.orgId));
  await emitMemberAdded({
    orgId: invitation.orgId,
    userId: created.user.id,
    role: created.grantedRole,
  });

  return {
    user: {
      id: created.user.id,
      email: created.user.email,
      displayName: created.user.displayName,
      avatarUrl: created.user.avatarUrl,
      createdAt: created.user.createdAt,
    },
    organization: toJoinedOrganization(invitation, created.grantedRole),
  };
}

// ─── Organization pending invitations (owner/admin) ─────

const orgInvitationSelect = {
  id: true,
  email: true,
  role: true,
  status: true,
  createdAt: true,
  expiresAt: true,
  invitedBy: { select: { displayName: true } },
} as const;

/** Invitations this organization has sent. Not the current user's inbox. */
export async function listOrgPendingInvitations(orgId: string) {
  return prisma.orgInvitation.findMany({
    where: { orgId, status: 'PENDING' },
    select: orgInvitationSelect,
    orderBy: { createdAt: 'desc' },
  });
}

async function findOrgInvitation(orgId: string, invitationId: string) {
  const invitation = await prisma.orgInvitation.findFirst({
    where: { id: invitationId, orgId },
  });
  if (!invitation) throw new NotFoundError('Invitation');
  return invitation;
}

/**
 * Replaces the stored token hash so the previous emailed link stops working,
 * extends the expiry, and enqueues a new invitation email. The new raw token
 * is never returned.
 */
export async function resendOrgInvitation(orgId: string, invitationId: string, actorId: string) {
  const invitation = await findOrgInvitation(orgId, invitationId);
  if (invitation.status !== 'PENDING') {
    throw new AppError('Only a pending invitation can be resent', 400);
  }

  const rawToken = generateToken(32);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITATION_TTL_DAYS);

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.orgInvitation.update({
      where: { id: invitation.id },
      data: { tokenHash: hashToken(rawToken), expiresAt },
      select: orgInvitationSelect,
    });
    await createActivityLog(tx, {
      orgId,
      actorId,
      action: 'invitation.resent',
      details: { email: invitation.email },
    });
    return row;
  });

  await queueInvitationEmail({
    orgId,
    actorId,
    email: invitation.email,
    rawToken,
    role: invitation.role,
    invitationId: invitation.id,
    existingUserId: null,
    notifyExistingUser: false,
  });

  return updated;
}

/**
 * Withdraws a pending invitation. The schema has no CANCELLED status, so this
 * uses DECLINED — the existing terminal state that blocks acceptance. The
 * activity log records `invitation.cancelled` so an admin cancel is distinct
 * from an invitee decline.
 */
export async function cancelOrgInvitation(orgId: string, invitationId: string, actorId: string) {
  const invitation = await findOrgInvitation(orgId, invitationId);
  if (invitation.status !== 'PENDING') {
    throw new AppError('Only a pending invitation can be cancelled', 400);
  }

  await prisma.$transaction(async (tx) => {
    await tx.orgInvitation.update({
      where: { id: invitation.id },
      data: { status: 'DECLINED' },
    });
    await createActivityLog(tx, {
      orgId,
      actorId,
      action: 'invitation.cancelled',
      details: { email: invitation.email },
    });
  });
}

// ─── Change Member Role ─────────────────────────────────

export async function changeMemberRole(
  orgId: string,
  memberId: string,
  actorId: string,
  actorRole: OrgRole,
  newRole: 'ADMIN' | 'MEMBER',
) {
  const member = await prisma.orgMember.findFirst({ where: { id: memberId, orgId } });
  if (!member) throw new NotFoundError('Member');

  // Only owner can change roles
  if (actorRole !== 'OWNER') {
    throw new AuthorizationError('Only the organization owner can change roles');
  }

  // Cannot change owner's role
  if (member.role === 'OWNER') {
    throw new AuthorizationError('Cannot change the owner\'s role');
  }

  // Cannot demote yourself
  if (member.userId === actorId) {
    throw new AuthorizationError('Cannot change your own role');
  }

  await prisma.$transaction(async (tx) => {
    await tx.orgMember.update({
      where: { id: memberId },
      data: { role: newRole },
    });

    await createActivityLog(tx, {
      orgId,
      actorId,
      action: 'member.role_changed',
      details: { memberId, oldRole: member.role, newRole },
    });
  });

  // Invalidate: org's member list + affected user's org list
  await cache.delete(cacheKeys.orgMembers(orgId), cacheKeys.userOrgs(member.userId));
}

// ─── Remove Member ──────────────────────────────────────

export async function removeMember(
  orgId: string,
  memberId: string,
  actorId: string,
  actorRole: OrgRole,
) {
  const member = await prisma.orgMember.findFirst({ where: { id: memberId, orgId } });
  if (!member) throw new NotFoundError('Member');

  // Owner cannot be removed
  if (member.role === 'OWNER') {
    throw new AuthorizationError('Cannot remove the organization owner');
  }

  // Cannot remove yourself (owner/admin)
  if (member.userId === actorId) {
    throw new AuthorizationError('Cannot remove yourself from the organization');
  }

  // Admin cannot remove another admin
  if (actorRole === 'ADMIN' && member.role === 'ADMIN') {
    throw new AuthorizationError('Admins cannot remove other admins');
  }

  await prisma.$transaction(async (tx) => {
    await tx.orgMember.delete({ where: { id: memberId } });

    await createActivityLog(tx, {
      orgId,
      actorId,
      action: 'member.removed',
      details: { userId: member.userId, role: member.role },
    });
  });

  // Invalidate: org's member list + removed user's org list
  await cache.delete(cacheKeys.orgMembers(orgId), cacheKeys.userOrgs(member.userId));

  await emitMemberRemoved({ orgId, memberId, userId: member.userId });
}
