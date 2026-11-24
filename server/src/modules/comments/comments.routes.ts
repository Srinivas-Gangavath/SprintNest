import { Router } from 'express';
import { csrfProtection } from '../../middleware/csrfProtection.js';
import { validate } from '../../middleware/validate.js';
import {
  createCommentSchema,
  updateCommentSchema,
  commentTaskParamsSchema,
  commentParamsSchema,
} from './comments.validation.js';
import * as commentController from './comments.controller.js';

const router = Router({ mergeParams: true });

// All routes already have authenticate + resolveOrgMembership from the parent mount chain:
// orgs/:orgId → resolveOrgMembership → projects/:projectId → tasks/:taskId → comments

router.post(
  '/',
  validate({ params: commentTaskParamsSchema }),
  csrfProtection,
  validate({ body: createCommentSchema }),
  commentController.create,
);

router.get(
  '/',
  validate({ params: commentTaskParamsSchema }),
  commentController.list,
);

router.patch(
  '/:commentId',
  validate({ params: commentParamsSchema }),
  csrfProtection,
  validate({ body: updateCommentSchema }),
  commentController.update,
);

router.delete(
  '/:commentId',
  validate({ params: commentParamsSchema }),
  csrfProtection,
  commentController.remove,
);

export default router;
