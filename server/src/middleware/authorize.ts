import type { Request, Response, NextFunction } from 'express';
import type { OrgRole } from '@prisma/client';
import { prisma } from '../config/database.js';
import { AuthorizationError, NotFoundError } from '../shared/errors/index.js';
import type { AuthenticatedRequest, OrgScopedRequest } from '../shared/types/index.js';

const ROLE_HIERARCHY: Record<OrgRole, number> = {
  OWNER: 3,
  ADMIN: 2,
  MEMBER: 1,
};

/**
 * Resolves the current user's membership in the org specified by `req.params.orgId`.
 * Attaches `req.org` with `{ orgId, role }`. Rejects if org is soft-deleted or user is not a member.
 */
export function resolveOrgMembership(req: Request, _res: Response, next: NextFunction): void {
  const authReq = req as AuthenticatedRequest;
  const orgId = Array.isArray(req.params.orgId) ? req.params.orgId[0] : req.params.orgId;

  if (!orgId) {
    next(new NotFoundError('Organization'));
    return;
  }

  prisma.organization
    .findFirst({
      where: { id: orgId, deletedAt: null },
      select: { id: true },
    })
    .then((org) => {
      if (!org) {
        throw new NotFoundError('Organization');
      }
      return prisma.orgMember.findUnique({
        where: { orgId_userId: { orgId, userId: authReq.user.id } },
        select: { role: true },
      });
    })
    .then((member) => {
      if (!member) {
        throw new AuthorizationError('You are not a member of this organization');
      }
      (req as OrgScopedRequest).org = { orgId, role: member.role };
      next();
    })
    .catch(next);
}

/**
 * Middleware factory: checks that the authenticated user's org role meets the minimum required role.
 * Must run after `resolveOrgMembership`.
 */
export function authorize(requiredRole: OrgRole) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const orgReq = req as OrgScopedRequest;
    if (!orgReq.org) {
      next(new AuthorizationError());
      return;
    }

    if (ROLE_HIERARCHY[orgReq.org.role] < ROLE_HIERARCHY[requiredRole]) {
      next(new AuthorizationError('Insufficient permissions'));
      return;
    }

    next();
  };
}
