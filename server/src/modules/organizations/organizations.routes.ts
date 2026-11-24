import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { resolveOrgMembership, authorize } from '../../middleware/authorize.js';
import { csrfProtection } from '../../middleware/csrfProtection.js';
import { validate } from '../../middleware/validate.js';
import { createOrgSchema, updateOrgSchema, orgIdParamSchema } from './organizations.validation.js';
import * as orgController from './organizations.controller.js';
import membersRouter from '../members/members.routes.js';
import projectsRouter from '../projects/projects.routes.js';
import labelsRouter from '../labels/labels.routes.js';
import activityRouter from '../activity/activity.routes.js';
import myTasksRouter from '../tasks/my-tasks.routes.js';

const router = Router();

// All org routes require authentication
router.use(authenticate);

router.post('/', csrfProtection, validate({ body: createOrgSchema }), orgController.create);
router.get('/', orgController.list);

// Routes scoped to a specific org
router.get('/:orgId', validate({ params: orgIdParamSchema }), resolveOrgMembership, orgController.getOne);
router.patch('/:orgId', validate({ params: orgIdParamSchema }), csrfProtection, resolveOrgMembership, authorize('ADMIN'), validate({ body: updateOrgSchema }), orgController.update);
router.delete('/:orgId', validate({ params: orgIdParamSchema }), csrfProtection, resolveOrgMembership, authorize('OWNER'), orgController.remove);

// Mount members sub-routes
router.use('/:orgId/members', validate({ params: orgIdParamSchema }), resolveOrgMembership, membersRouter);

// Mount projects sub-routes
router.use('/:orgId/projects', validate({ params: orgIdParamSchema }), resolveOrgMembership, projectsRouter);

// Mount labels sub-routes
router.use('/:orgId/labels', validate({ params: orgIdParamSchema }), resolveOrgMembership, labelsRouter);

// Tasks assigned to the signed-in member of this organization.
router.use('/:orgId/my-tasks', validate({ params: orgIdParamSchema }), resolveOrgMembership, myTasksRouter);

// Audit log. Owners and admins only; the service also filters by this org id.
router.use(
  '/:orgId/activity',
  validate({ params: orgIdParamSchema }),
  resolveOrgMembership,
  authorize('ADMIN'),
  activityRouter,
);

export default router;
