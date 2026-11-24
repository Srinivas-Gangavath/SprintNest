import type { Request, Response, NextFunction } from 'express';
import type { OrgScopedRequest } from '../../shared/types/index.js';
import * as projectService from './projects.service.js';

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const project = await projectService.createProject(orgReq.org.orgId, orgReq.user.id, req.body);
    res.status(201).json({ status: 'success', data: { project } });
  } catch (err) {
    next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const includeArchived = (req.query as { includeArchived?: string }).includeArchived === 'true';
    const projects = await projectService.listProjects(orgReq.org.orgId, includeArchived);
    res.json({ status: 'success', data: { projects } });
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const projectId = req.params.projectId as string;
    const project = await projectService.getProject(orgReq.org.orgId, projectId);
    res.json({ status: 'success', data: { project } });
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const projectId = req.params.projectId as string;
    const project = await projectService.updateProject(
      orgReq.org.orgId,
      projectId,
      orgReq.user.id,
      req.body,
    );
    res.json({ status: 'success', data: { project } });
  } catch (err) {
    next(err);
  }
}

export async function archive(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const projectId = req.params.projectId as string;
    const project = await projectService.archiveProject(
      orgReq.org.orgId,
      projectId,
      orgReq.user.id,
      req.body.isArchived,
    );
    res.json({ status: 'success', data: { project } });
  } catch (err) {
    next(err);
  }
}
