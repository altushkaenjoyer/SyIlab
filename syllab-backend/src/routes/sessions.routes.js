'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/sessions.controller');
const { authenticate, requireVerified } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/rbac.middleware');
const { validate } = require('../middleware/validate.middleware');
const {
  createSessionSchema, openSessionSchema, submitBaselineSchema,
} = require('../validators/schemas');

const router = Router();

router.use(authenticate, requireVerified);

router.post('/',
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate(createSessionSchema),
  ctrl.createSession
);

router.get('/', ctrl.listSessions);

router.patch('/:session_id/open',
  requireRole('INSTRUCTOR', 'PROCTOR', 'ADMIN'),
  validate(openSessionSchema),
  ctrl.openSession
);

router.patch('/:session_id/close',
  requireRole('INSTRUCTOR', 'PROCTOR', 'ADMIN'),
  ctrl.closeSession
);

router.post('/:session_id/baseline',
  requireRole('STUDENT'),
  validate(submitBaselineSchema),
  ctrl.submitBaseline
);

router.get('/:session_id/attendance',
  requireRole('INSTRUCTOR', 'PROCTOR', 'ADMIN'),
  ctrl.getAttendance
);

module.exports = router;
    