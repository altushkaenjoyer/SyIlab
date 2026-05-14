'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/courses.controller');
const { authenticate, requireVerified } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/rbac.middleware');
const { validate } = require('../middleware/validate.middleware');
const { createCourseSchema, enrollStudentSchema } = require('../validators/schemas');

const router = Router();

router.use(authenticate, requireVerified);

router.post('/', requireRole('INSTRUCTOR', 'ADMIN'), validate(createCourseSchema), ctrl.createCourse);
router.get('/', ctrl.listCourses);
router.post('/:course_id/enroll', requireRole('INSTRUCTOR', 'ADMIN'), validate(enrollStudentSchema), ctrl.enrollStudent);
router.get('/:course_id/students', requireRole('INSTRUCTOR', 'ADMIN'), ctrl.listStudents);

module.exports = router;
