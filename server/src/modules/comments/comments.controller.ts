import type { Request, Response, NextFunction } from 'express';
import type { OrgScopedRequest } from '../../shared/types/index.js';
import * as commentService from './comments.service.js';

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    const comment = await commentService.createComment(
      orgReq.org.orgId,
      projectId,
      taskId,
      orgReq.user.id,
      req.body,
    );
    res.status(201).json({ status: 'success', data: { comment } });
  } catch (err) {
    next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    const comments = await commentService.listComments(
      orgReq.org.orgId,
      projectId,
      taskId,
    );
    res.json({ status: 'success', data: { comments } });
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    const commentId = req.params.commentId as string;
    const comment = await commentService.updateComment(
      orgReq.org.orgId,
      projectId,
      taskId,
      commentId,
      orgReq.user.id,
      orgReq.org.role,
      req.body,
    );
    res.json({ status: 'success', data: { comment } });
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    const commentId = req.params.commentId as string;
    await commentService.deleteComment(
      orgReq.org.orgId,
      projectId,
      taskId,
      commentId,
      orgReq.user.id,
      orgReq.org.role,
    );
    res.json({ status: 'success', data: null });
  } catch (err) {
    next(err);
  }
}
