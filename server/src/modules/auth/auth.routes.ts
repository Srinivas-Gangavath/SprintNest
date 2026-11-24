import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { csrfProtection } from '../../middleware/csrfProtection.js';
import { authRateLimiter } from '../../middleware/rateLimiter.js';
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from './auth.validation.js';
import * as authController from './auth.controller.js';

const router = Router();

// Public routes (rate-limited)
router.post('/register', authRateLimiter, csrfProtection, validate({ body: registerSchema }), authController.register);
router.post('/login', authRateLimiter, csrfProtection, validate({ body: loginSchema }), authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', csrfProtection, authController.logout);
router.post('/forgot-password', authRateLimiter, csrfProtection, validate({ body: forgotPasswordSchema }), authController.forgotPassword);
router.post('/reset-password', authRateLimiter, csrfProtection, validate({ body: resetPasswordSchema }), authController.resetPassword);

// Protected routes
router.get('/me', authenticate, authController.getMe);
router.patch('/me', authenticate, csrfProtection, authController.updateMe);

export default router;
