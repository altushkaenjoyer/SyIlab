'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/queue.controller');
const { authenticate, requireVerified } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/rbac.middleware');
const { validate } = require('../middleware/validate.middleware');
const { resolveQueueSchema } = require('../validators/schemas');

const router = Router();

router.use(authenticate, requireVerified);
router.use(requireRole('INSTRUCTOR', 'ADMIN'));

router.get('/', ctrl.getQueue);
router.get('/:item_id', ctrl.getQueueItem);
router.patch('/:item_id/resolve', validate(resolveQueueSchema), ctrl.resolveQueueItem);

module.exports = router;
