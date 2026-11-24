import type { Request, Response, NextFunction } from 'express';
import type { OrgScopedRequest, AuthenticatedRequest } from '../../shared/types/index.js';
import { establishSession } from '../auth/auth.controller.js';
import * as membersService from './members.service.js';

export async function listMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const members = await membersService.listMembers(orgReq.org.orgId);
    res.json({ status: 'success', data: { members } });
  } catch (err) {
    next(err);
  }
}

export async function invite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const invitation = await membersService.inviteMember(orgReq.org.orgId, orgReq.user.id, req.body);
    res.status(201).json({ status: 'success', data: { invitation } });
  } catch (err) {
    next(err);
  }
}

export async function changeRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    await membersService.changeMemberRole(
      orgReq.org.orgId,
      req.params.memberId as string,
      orgReq.user.id,
      orgReq.org.role,
      req.body.role,
    );
    res.json({ status: 'success', data: null });
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    await membersService.removeMember(
      orgReq.org.orgId,
      req.params.memberId as string,
      orgReq.user.id,
      orgReq.org.role,
    );
    res.json({ status: 'success', data: null });
  } catch (err) {
    next(err);
  }
}

// ─── Invitation endpoints (user-scoped, not org-scoped) ─

export async function listPendingInvitations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authReq = req as AuthenticatedRequest;
    const invitations = await membersService.listPendingInvitations(authReq.user.email);
    res.json({ status: 'success', data: { invitations } });
  } catch (err) {
    next(err);
  }
}

export async function acceptInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await membersService.acceptInvitation(
      req.params.token as string,
      authReq.user.id,
      authReq.user.email,
    );
    res.json({
      status: 'success',
      data: { message: 'Invitation accepted', organization: result.organization },
    });
  } catch (err) {
    next(err);
  }
}

export async function declineInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authReq = req as AuthenticatedRequest;
    await membersService.declineInvitation(req.params.token as string, authReq.user.id, authReq.user.email);
    res.json({ status: 'success', data: { message: 'Invitation declined' } });
  } catch (err) {
    next(err);
  }
}

export async function previewInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invitation = await membersService.previewInvitation(req.params.token as string);
    res.json({ status: 'success', data: { invitation } });
  } catch (err) {
    next(err);
  }
}

export async function registerFromInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await membersService.registerAndAcceptInvitation(req.params.token as string, req.body);
    await establishSession(res, result.user);
    res.status(201).json({
      status: 'success',
      data: {
        message: 'Invitation accepted',
        user: result.user,
        organization: result.organization,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function listOrgInvitations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const invitations = await membersService.listOrgPendingInvitations(orgReq.org.orgId);
    res.json({ status: 'success', data: { invitations } });
  } catch (err) {
    next(err);
  }
}

export async function resendInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const invitation = await membersService.resendOrgInvitation(
      orgReq.org.orgId,
      req.params.invitationId as string,
      orgReq.user.id,
    );
    res.json({ status: 'success', data: { invitation } });
  } catch (err) {
    next(err);
  }
}

export async function cancelInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    await membersService.cancelOrgInvitation(
      orgReq.org.orgId,
      req.params.invitationId as string,
      orgReq.user.id,
    );
    res.json({ status: 'success', data: { message: 'Invitation cancelled' } });
  } catch (err) {
    next(err);
  }
}
