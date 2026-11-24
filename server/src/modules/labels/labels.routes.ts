import { Router } from 'express';
import { authorize } from '../../middleware/authorize.js';
import { csrfProtection } from '../../middleware/csrfProtection.js';
import { validate } from '../../middleware/validate.js';
import {
  createLabelSchema,
  updateLabelSchema,
  labelIdParamSchema,
} from './labels.validation.js';
import * as labelController from './labels.controller.js';

const router = Router({ mergeParams: true });

// All routes already have authenticate + resolveOrgMembership from the parent mount

router.post(
  '/',
  csrfProtection,
  authorize('ADMIN'),
  validate({ body: createLabelSchema }),
  labelController.create,
);

router.get('/', labelController.list);

router.patch(
  '/:labelId',
  validate({ params: labelIdParamSchema }),
  csrfProtection,
  authorize('ADMIN'),
  validate({ body: updateLabelSchema }),
  labelController.update,
);

router.delete(
  '/:labelId',
  validate({ params: labelIdParamSchema }),
  csrfProtection,
  authorize('ADMIN'),
  labelController.remove,
);

export default router;
