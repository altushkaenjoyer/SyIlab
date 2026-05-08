'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/submissions.controller');
const { authenticate, requireVerified } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/rbac.middleware');
const { validate, validateQuery } = require('../middleware/validate.middleware');
const { rateLimitSubmission } = require('../middleware/rateLimit.middleware');
const { analyzeSchema, listSubmissionsQuery } = require('../validators/schemas');

const router = Router();

router.use(authenticate, requireVerified);

router.post('/analyze',
  requireRole('STUDENT'),
  rateLimitSubmission,
  validate(analyzeSchema),
  ctrl.analyze
);

router.get('/', validateQuery(listSubmissionsQuery), ctrl.listSubmissions);

router.get('/:submission_id', ctrl.getSubmission);

module.exports = router;
