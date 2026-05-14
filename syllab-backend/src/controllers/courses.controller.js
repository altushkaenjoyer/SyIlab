'use strict';

const { getClient } = require('../config/database');

// ── POST /courses ──────────────────────────────────────────────────────────

async function createCourse(req, res, next) {
  try {
    const prisma = getClient();
    const { name, institution_name, cohort_name, alert_threshold, max_violations } = req.body;
    const instructorId = req.user.id;

    const institution = await prisma.institution.upsert({
      where: { name: institution_name },
      update: {},
      create: { name: institution_name },
    });

    const cohort = await prisma.cohort.findFirst({ where: { name: cohort_name } });
    const cohortRecord = cohort ?? await prisma.cohort.create({ data: { name: cohort_name } });

    const course = await prisma.course.create({
      data: {
        name,
        institutionId: institution.id,
        instructorId,
        cohortId: cohortRecord.id,
        alertThreshold: alert_threshold ?? 2.5,
        maxViolations: max_violations ?? 8,
      },
    });

    return res.status(201).json({
      data: {
        id: course.id,
        name: course.name,
        institution: institution_name,
        cohort: cohort_name,
        instructor_id: course.instructorId,
        alert_threshold: course.alertThreshold,
        max_violations: course.maxViolations,
        created_at: course.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /courses ───────────────────────────────────────────────────────────

async function listCourses(req, res, next) {
  try {
    const prisma = getClient();
    const where = req.user.role === 'INSTRUCTOR'
      ? { instructorId: req.user.id }
      : req.user.role === 'STUDENT'
        ? { enrollments: { some: { studentId: req.user.id } } }
        : {};

    const courses = await prisma.course.findMany({
      where,
      include: {
        institution: { select: { name: true } },
        cohort: { select: { name: true } },
        instructor: { select: { fullName: true, email: true } },
        _count: { select: { enrollments: true, sessions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({
      data: courses.map(c => ({
        id: c.id,
        name: c.name,
        institution: c.institution.name,
        cohort: c.cohort.name,
        instructor: c.instructor.fullName,
        alert_threshold: c.alertThreshold,
        max_violations: c.maxViolations,
        enrolled_students: c._count.enrollments,
        sessions: c._count.sessions,
        created_at: c.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
}

// ── POST /courses/:course_id/enroll ────────────────────────────────────────

async function enrollStudent(req, res, next) {
  try {
    const prisma = getClient();
    const { course_id } = req.params;
    const { student_email } = req.body;

    const course = await prisma.course.findFirst({
      where: { id: course_id, instructorId: req.user.id },
    });
    if (!course && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not own this course', status: 403 });
    }

    const student = await prisma.user.findUnique({
      where: { email: student_email },
      select: { id: true, fullName: true, email: true, role: true },
    });
    if (!student) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Student not found', status: 404 });
    }
    if (student.role !== 'STUDENT') {
      return res.status(400).json({ error: 'INVALID_ROLE', message: 'User is not a student', status: 400 });
    }

    await prisma.enrollment.upsert({
      where: { studentId_courseId: { studentId: student.id, courseId: course_id } },
      update: {},
      create: { studentId: student.id, courseId: course_id },
    });

    return res.status(200).json({
      data: {
        course_id,
        student_id: student.id,
        student_name: student.fullName,
        student_email: student.email,
      },
      message: 'Student enrolled successfully',
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /courses/:course_id/students ──────────────────────────────────────

async function listStudents(req, res, next) {
  try {
    const prisma = getClient();
    const { course_id } = req.params;

    const enrollments = await prisma.enrollment.findMany({
      where: { courseId: course_id },
      include: { student: { select: { id: true, fullName: true, email: true } } },
      orderBy: { enrolledAt: 'asc' },
    });

    return res.status(200).json({
      data: enrollments.map(e => ({
        student_id: e.student.id,
        name: e.student.fullName,
        email: e.student.email,
        enrolled_at: e.enrolledAt,
      })),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { createCourse, listCourses, enrollStudent, listStudents };
