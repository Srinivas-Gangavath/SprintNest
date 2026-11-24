import { Router } from 'express';
import { csrfProtection } from '../../middleware/csrfProtection.js';
import { validate } from '../../middleware/validate.js';
import {
  createTaskSchema,
  updateTaskSchema,
  taskParamsSchema,
  taskProjectParamsSchema,
  listTasksQuerySchema,
} from './tasks.validation.js';
import * as taskController from './tasks.controller.js';
import commentsRouter from '../comments/comments.routes.js';

const router = Router({ mergeParams: true });

// All routes already have authenticate + resolveOrgMembership from the parent mount
// All org members (MEMBER and above) can create, read, update, and delete tasks per the RBAC table

router.post(
  '/',
  validate({ params: taskProjectParamsSchema }),
  csrfProtection,
  validate({ body: createTaskSchema }),
  taskController.create,
);

router.get(
  '/',
  validate({ params: taskProjectParamsSchema, query: listTasksQuerySchema }),
  taskController.list,
);

router.get(
  '/stats',
  validate({ params: taskProjectParamsSchema }),
  taskController.getStats,
);

router.get(
  '/:taskId',
  validate({ params: taskParamsSchema }),
  taskController.getOne,
);

router.patch(
  '/:taskId',
  validate({ params: taskParamsSchema }),
  csrfProtection,
  validate({ body: updateTaskSchema }),
  taskController.update,
);

router.delete(
  '/:taskId',
  validate({ params: taskParamsSchema }),
  csrfProtection,
  taskController.remove,
);

// Mount comments sub-routes under /:taskId/comments
router.use('/:taskId/comments', commentsRouter);

export default router;

