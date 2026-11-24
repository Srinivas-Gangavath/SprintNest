import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { listMyTasksQuerySchema } from './tasks.validation.js';
import * as taskController from './tasks.controller.js';

const router = Router({ mergeParams: true });

// Membership is resolved by the parent mount. Any member may list their own tasks.
// The service pins assigneeId to the authenticated user and orgId to the membership.
router.get('/', validate({ query: listMyTasksQuerySchema }), taskController.listMine);

export default router;
