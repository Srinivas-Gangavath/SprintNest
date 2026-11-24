import { prisma } from '../../config/database.js';
import { NotFoundError, AuthorizationError } from '../../shared/errors/index.js';
import type { NotificationType, NotificationData } from './notifications.types.js';
import { cache, cacheKeys, cacheTTL } from '../../shared/cache.js';

// ─── Create ──────────────────────────────────────────

/**
 * Creates a notification for a specific user.
 * Supports optional dedupeKey backed by a database unique constraint for safe idempotency.
 */
export async function createNotification(params: {
  userId: string;
  type: NotificationType;
  title: string;
  data: NotificationData;
  dedupeKey?: string | null;
}): Promise<{ notification: any; isDuplicate: boolean }> {
  // If dedupeKey is provided, check if already created
  if (params.dedupeKey) {
    const existing = await prisma.notification.findUnique({
      where: { dedupeKey: params.dedupeKey },
    });
    if (existing) {
      return { notification: existing, isDuplicate: true };
    }
  }

  try {
    const notification = await prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        data: params.data as any,
        dedupeKey: params.dedupeKey ?? null,
      },
    });

    // Invalidate unread count cache
    await cache.delete(cacheKeys.userUnreadCount(params.userId));

    return { notification, isDuplicate: false };
  } catch (err: any) {
    // Concurrent insert conflict on unique dedupe_key (Prisma P2002)
    if (err?.code === 'P2002' && params.dedupeKey) {
      const existing = await prisma.notification.findUnique({
        where: { dedupeKey: params.dedupeKey },
      });
      if (existing) {
        return { notification: existing, isDuplicate: true };
      }
    }
    throw err;
  }
}

// ─── List ────────────────────────────────────────────

export async function listNotifications(params: {
  userId: string;
  page: number;
  limit: number;
  unreadOnly: boolean;
}) {
  const { userId, page, limit, unreadOnly } = params;
  const skip = (page - 1) * limit;

  const where: any = { userId };
  if (unreadOnly) {
    where.isRead = false;
  }

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.notification.count({ where }),
  ]);

  return {
    notifications,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

// ─── Unread Count ────────────────────────────────────

/**
 * Returns the count of unread notifications for a user.
 * Uses cache-aside with 60s TTL.
 */
export async function getUnreadCount(userId: string): Promise<number> {
  // Cache-aside: check Redis first
  const key = cacheKeys.userUnreadCount(userId);
  const cached = await cache.get<number>(key);
  if (cached !== null) return cached;

  // Cache miss: count from database
  const count = await prisma.notification.count({
    where: { userId, isRead: false },
  });

  // Populate cache
  await cache.set(key, count, cacheTTL.UNREAD_COUNT);

  return count;
}

// ─── Mark One Read ───────────────────────────────────

export async function markAsRead(params: {
  notificationId: string;
  userId: string;
}) {
  const notification = await prisma.notification.findUnique({
    where: { id: params.notificationId },
  });

  if (!notification) {
    throw new NotFoundError('Notification not found');
  }

  if (notification.userId !== params.userId) {
    throw new AuthorizationError('You do not have permission to access this notification');
  }

  // Idempotent: if already read, just return it
  if (notification.isRead) {
    return notification;
  }

  const updated = await prisma.notification.update({
    where: { id: params.notificationId },
    data: { isRead: true },
  });

  // Invalidate unread count cache
  await cache.delete(cacheKeys.userUnreadCount(params.userId));

  return updated;
}

// ─── Mark All Read ───────────────────────────────────

export async function markAllAsRead(userId: string) {
  const result = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });

  // Invalidate unread count cache
  await cache.delete(cacheKeys.userUnreadCount(userId));

  return { updatedCount: result.count };
}

