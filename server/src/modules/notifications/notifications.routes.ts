import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { csrfProtection } from '../../middleware/csrfProtection.js';
import { validate } from '../../middleware/validate.js';
import {
  listNotificationsQuerySchema,
  notificationIdParamSchema,
} from './notifications.validation.js';
import * as notificationController from './notifications.controller.js';

const router = Router();

// All notification routes require authentication
router.use(authenticate);

// GET /api/v1/notifications — list notifications with pagination + optional unread filter
router.get(
  '/',
  validate({ query: listNotificationsQuerySchema }),
  notificationController.list as any,
);

// GET /api/v1/notifications/unread-count — get unread count for badge
router.get(
  '/unread-count',
  notificationController.unreadCount as any,
);

// PATCH /api/v1/notifications/:notificationId/read — mark one as read
router.patch(
  '/:notificationId/read',
  csrfProtection,
  validate({ params: notificationIdParamSchema }),
  notificationController.markRead as any,
);

// POST /api/v1/notifications/read-all — mark all as read
router.post(
  '/read-all',
  csrfProtection,
  notificationController.markAllRead as any,
);

export default router;
