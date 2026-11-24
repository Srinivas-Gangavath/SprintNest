import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { csrfProtection } from '../../middleware/csrfProtection.js';
import { authRateLimiter } from '../../middleware/rateLimiter.js';
import { validate } from '../../middleware/validate.js';
import {
  invitationTokenParamSchema,
  registerFromInvitationSchema,
} from '../members/members.validation.js';
import * as membersController from '../members/members.controller.js';

const router = Router();

// Received by the signed-in user. Distinct from an organization's sent invites.
router.get('/pending', authenticate, membersController.listPendingInvitations);

// Public to the token holder. The token is the credential; CSRF still guards the mutation.
router.get(
  '/:token',
  authRateLimiter,
  validate({ params: invitationTokenParamSchema }),
  membersController.previewInvitation,
);
router.post(
  '/:token/register',
  authRateLimiter,
  csrfProtection,
  validate({ params: invitationTokenParamSchema, body: registerFromInvitationSchema }),
  membersController.registerFromInvitation,
);

router.post(
  '/:token/accept',
  authenticate,
  csrfProtection,
  validate({ params: invitationTokenParamSchema }),
  membersController.acceptInvitation,
);
router.post(
  '/:token/decline',
  authenticate,
  csrfProtection,
  validate({ params: invitationTokenParamSchema }),
  membersController.declineInvitation,
);

export default router;
