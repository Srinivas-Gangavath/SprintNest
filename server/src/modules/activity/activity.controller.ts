import type { Request, Response, NextFunction } from 'express';
import type { OrgScopedRequest } from '../../shared/types/index.js';
import * as activityService from './activity.service.js';

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const query = req.query as { page?: number; limit?: number };
    const result = await activityService.listActivity(
      orgReq.org.orgId,
      Number(query.page) || 1,
      Number(query.limit) || 20,
    );
    res.json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
}
