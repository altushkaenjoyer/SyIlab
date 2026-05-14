'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/auth.controller');
const { rateLimitAuth } = require('../middleware/rateLimit.middleware');
const { validate } = require('../middleware/validate.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const {
  registerSchema, loginSchema, refreshSchema, logoutSchema,
  verifyEmailSchema, resendVerificationSchema, forgotPasswordSchema, resetPasswordSchema,
} = require('../validators/schemas');

const router = Router();

router.post('/register', rateLimitAuth, validate(registerSchema), ctrl.register);
router.post('/login', rateLimitAuth, validate(loginSchema), ctrl.login);
router.post('/refresh', validate(refreshSchema), ctrl.refresh);
router.post('/logout', authenticate, validate(logoutSchema), ctrl.logout);
router.get('/me', authenticate, ctrl.me);

router.post('/verify-email', validate(verifyEmailSchema), ctrl.verifyEmail);
router.post('/resend-verification', rateLimitAuth, validate(resendVerificationSchema), ctrl.resendVerification);
router.post('/forgot-password', rateLimitAuth, validate(forgotPasswordSchema), ctrl.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), ctrl.resetPassword);

// DEV ONLY — достаёт токены из БД без email, недоступен в production
if (process.env.NODE_ENV !== 'production') {
  router.get('/dev/token', ctrl.devGetToken);
}

module.exports = router;
