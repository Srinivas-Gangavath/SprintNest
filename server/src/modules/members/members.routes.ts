import { Router } from 'express';
import { authorize } from '../../middleware/authorize.js';
import { csrfProtection } from '../../middleware/csrfProtection.js';
import { validate } from '../../middleware/validate.js';
import { inviteMemberSchema, changeRoleSchema, memberIdParamSchema, invitationIdParamSchema } from './members.validation.js';
import * as membersController from './members.controller.js';

// This router is mounted under /api/v1/orgs/:orgId/members
// Authentication and resolveOrgMembership are already applied by the parent router
const router = Router({ mergeParams: true });

router.get('/', membersController.listMembers);
// Invitations sent by this organization. Owner/Admin only. Not the user's inbox.
router.get('/invitations', authorize('ADMIN'), membersController.listOrgInvitations);
router.post('/invitations', csrfProtection, authorize('ADMIN'), validate({ body: inviteMemberSchema }), membersController.invite);
router.post(
  '/invitations/:invitationId/resend',
  csrfProtection,
  authorize('ADMIN'),
  validate({ params: invitationIdParamSchema }),
  membersController.resendInvitation,
);
router.post(
  '/invitations/:invitationId/cancel',
  csrfProtection,
  authorize('ADMIN'),
  validate({ params: invitationIdParamSchema }),
  membersController.cancelInvitation,
);
router.patch('/:memberId/role', csrfProtection, validate({ params: memberIdParamSchema, body: changeRoleSchema }), membersController.changeRole);
router.delete('/:memberId', csrfProtection, validate({ params: memberIdParamSchema }), authorize('ADMIN'), membersController.remove);

export default router;
