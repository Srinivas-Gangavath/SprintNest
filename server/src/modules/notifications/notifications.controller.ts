import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../../shared/types/index.js';
import * as notificationService from './notifications.service.js';

// ─── List Notifications ─────────────────────────────

export async function list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, unreadOnly } = req.query as any;
    const result = await notificationService.listNotifications({
      userId: req.user!.id,
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      unreadOnly: unreadOnly === true || unreadOnly === 'true',
    });

    res.json({
      status: 'success',
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

// ─── Unread Count ───────────────────────────────────

export async function unreadCount(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const count = await notificationService.getUnreadCount(req.user!.id);

    res.json({
      status: 'success',
      data: { unreadCount: count },
    });
  } catch (err) {
    next(err);
  }
}

// ─── Mark One Read ──────────────────────────────────

export async function markRead(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const notification = await notificationService.markAsRead({
      notificationId: req.params.notificationId as string,
      userId: req.user!.id,
    });

    res.json({
      status: 'success',
      data: { notification },
    });
  } catch (err) {
    next(err);
  }
}

// ─── Mark All Read ──────────────────────────────────

export async function markAllRead(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const result = await notificationService.markAllAsRead(req.user!.id);

    res.json({
      status: 'success',
      data: result,
    });
  } catch (err) {
    next(err);
  }
}
