import type { Request, Response, NextFunction } from 'express';
import type { OrgScopedRequest } from '../../shared/types/index.js';
import * as taskService from './tasks.service.js';

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const projectId = req.params.projectId as string;
    const task = await taskService.createTask(
      orgReq.org.orgId,
      projectId,
      orgReq.user.id,
      req.body,
    );
    res.status(201).json({ status: 'success', data: { task } });
  } catch (err) {
    next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const projectId = req.params.projectId as string;
    const query = req.query as {
      status?: string;
      priority?: string;
      assigneeId?: string;
      labelId?: string;
      page?: number;
      limit?: number;
    };

    const result = await taskService.listTasks(
      orgReq.org.orgId,
      projectId,
      {
        status: query.status as any,
        priority: query.priority as any,
        assigneeId: query.assigneeId,
        labelId: query.labelId,
        page: Number(query.page) || 1,
        limit: Number(query.limit) || 20,
      },
    );
    res.json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
}

export async function listMine(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const query = req.query as {
      status?: string;
      priority?: string;
      page?: number;
      limit?: number;
    };
    const result = await taskService.listMyTasks(orgReq.org.orgId, orgReq.user.id, {
      status: query.status as never,
      priority: query.priority as never,
      page: Number(query.page) || 1,
      limit: Number(query.limit) || 20,
    });
    res.json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    const task = await taskService.getTask(orgReq.org.orgId, projectId, taskId);
    res.json({ status: 'success', data: { task } });
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    const task = await taskService.updateTask(
      orgReq.org.orgId,
      projectId,
      taskId,
      orgReq.user.id,
      req.body,
    );
    res.json({ status: 'success', data: { task } });
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    await taskService.deleteTask(orgReq.org.orgId, projectId, taskId, orgReq.user.id);
    res.json({ status: 'success', data: null });
  } catch (err) {
    next(err);
  }
}

export async function getStats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const projectId = req.params.projectId as string;
    const stats = await taskService.getTaskStats(orgReq.org.orgId, projectId);
    res.json({ status: 'success', data: { stats } });
  } catch (err) {
    next(err);
  }
}
