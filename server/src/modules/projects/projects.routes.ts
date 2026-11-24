import { Router } from 'express';
import { authorize } from '../../middleware/authorize.js';
import { csrfProtection } from '../../middleware/csrfProtection.js';
import { validate } from '../../middleware/validate.js';
import {
  createProjectSchema,
  updateProjectSchema,
  archiveProjectSchema,
  projectIdParamSchema,
  listProjectsQuerySchema,
} from './projects.validation.js';
import * as projectController from './projects.controller.js';
import tasksRouter from '../tasks/tasks.routes.js';

const router = Router({ mergeParams: true });

// All routes already have authenticate + resolveOrgMembership from the parent mount

router.post(
  '/',
  csrfProtection,
  authorize('ADMIN'),
  validate({ body: createProjectSchema }),
  projectController.create,
);

router.get(
  '/',
  validate({ query: listProjectsQuerySchema }),
  projectController.list,
);

router.get(
  '/:projectId',
  validate({ params: projectIdParamSchema }),
  projectController.getOne,
);

router.patch(
  '/:projectId',
  validate({ params: projectIdParamSchema }),
  csrfProtection,
  authorize('ADMIN'),
  validate({ body: updateProjectSchema }),
  projectController.update,
);

router.patch(
  '/:projectId/archive',
  validate({ params: projectIdParamSchema }),
  csrfProtection,
  authorize('ADMIN'),
  validate({ body: archiveProjectSchema }),
  projectController.archive,
);

// Mount tasks sub-routes under /:projectId/tasks
router.use('/:projectId/tasks', tasksRouter);

export default router;
