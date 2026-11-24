import type { Request, Response, NextFunction } from 'express';
import type { OrgScopedRequest } from '../../shared/types/index.js';
import * as labelService from './labels.service.js';

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const label = await labelService.createLabel(orgReq.org.orgId, orgReq.user.id, req.body);
    res.status(201).json({ status: 'success', data: { label } });
  } catch (err) {
    next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const labels = await labelService.listLabels(orgReq.org.orgId);
    res.json({ status: 'success', data: { labels } });
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const labelId = req.params.labelId as string;
    const label = await labelService.updateLabel(
      orgReq.org.orgId,
      labelId,
      orgReq.user.id,
      req.body,
    );
    res.json({ status: 'success', data: { label } });
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const labelId = req.params.labelId as string;
    await labelService.deleteLabel(orgReq.org.orgId, labelId, orgReq.user.id);
    res.json({ status: 'success', data: null });
  } catch (err) {
    next(err);
  }
}
