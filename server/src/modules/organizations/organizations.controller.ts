import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedRequest, OrgScopedRequest } from '../../shared/types/index.js';
import * as orgService from './organizations.service.js';

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authReq = req as AuthenticatedRequest;
    const org = await orgService.createOrganization(authReq.user.id, req.body);
    res.status(201).json({ status: 'success', data: { organization: org } });
  } catch (err) {
    next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authReq = req as AuthenticatedRequest;
    const orgs = await orgService.listUserOrganizations(authReq.user.id);
    res.json({ status: 'success', data: { organizations: orgs } });
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const org = await orgService.getOrganization(orgReq.org.orgId);
    res.json({ status: 'success', data: { organization: org } });
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const org = await orgService.updateOrganization(orgReq.org.orgId, orgReq.user.id, req.body);
    res.json({ status: 'success', data: { organization: org } });
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    await orgService.softDeleteOrganization(orgReq.org.orgId, orgReq.user.id);
    res.json({ status: 'success', data: null });
  } catch (err) {
    next(err);
  }
}
