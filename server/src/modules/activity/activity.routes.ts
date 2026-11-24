import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { listActivityQuerySchema } from './activity.validation.js';
import * as activityController from './activity.controller.js';

const router = Router({ mergeParams: true });

router.get('/', validate({ query: listActivityQuerySchema }), activityController.list);

export default router;
