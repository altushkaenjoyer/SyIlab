'use strict';

const { z } = require('zod');

// ── Auth schemas ───────────────────────────────────────────────────────────

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  full_name: z.string().min(2, 'Full name must be at least 2 characters').max(100),
  role: z.enum(['STUDENT', 'INSTRUCTOR', 'PROCTOR', 'ADMIN']).optional().default('STUDENT'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});

const refreshSchema = z.object({
  refresh_token: z.string().min(1, 'Refresh token is required'),
});

const logoutSchema = z.object({
  refresh_token: z.string().optional(),
});

const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

const resendVerificationSchema = z.object({
  email: z.string().email('Invalid email address'),
});

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  new_password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
});

// ── Course schemas ─────────────────────────────────────────────────────────

const createCourseSchema = z.object({
  name: z.string().min(2).max(200),
  institution_name: z.string().min(2).max(200),
  cohort_name: z.string().min(2).max(100),
  alert_threshold: z.number().min(0).max(10).optional(),
  max_violations: z.number().int().min(1).max(50).optional(),
});

const enrollStudentSchema = z.object({
  student_email: z.string().email(),
});

// ── Session schemas ────────────────────────────────────────────────────────

const createSessionSchema = z.object({
  course_id: z.string().min(1),
  scheduled_at: z.string().datetime('scheduled_at must be an ISO 8601 datetime'),
  duration_minutes: z.number().int().min(10).max(180),
  room_label: z.string().max(100).optional(),
});

const openSessionSchema = z.object({
  network_isolation_confirmed: z.boolean().optional().default(false),
});

const closeSessionSchema = z.object({}).optional();

const submitBaselineSchema = z.object({
  code: z.string().min(10, 'Code must be at least 10 characters').max(50000),
  language: z.enum(['python', 'javascript', 'typescript']),
});

// ── Submission schemas ─────────────────────────────────────────────────────

const analyzeSchema = z.object({
  course_id: z.string().min(1),
  week_number: z.number().int().min(1).max(20),
  language: z.enum(['python', 'javascript', 'typescript']),
  code: z.string().min(10, 'Code must be at least 10 characters').max(100000),
});

// ── Queue schemas ──────────────────────────────────────────────────────────

const resolveQueueSchema = z.object({
  status: z.enum(['REVIEWED', 'CLEARED', 'CONFIRMED']),
  instructor_note: z.string().max(2000).optional(),
});

// ── Query param schemas ────────────────────────────────────────────────────

const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});

const listSubmissionsQuery = paginationSchema.extend({
  student_id: z.string().optional(),
  course_id: z.string().optional(),
  week_number: z.string().regex(/^\d+$/).optional(),
  flag_level: z.enum(['NORMAL', 'MONITOR', 'REVIEW', 'INTERVIEW']).optional(),
  sort: z.enum(['created_at', '-created_at', 'ensemble_score', '-ensemble_score']).optional(),
});

module.exports = {
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  createCourseSchema,
  enrollStudentSchema,
  createSessionSchema,
  openSessionSchema,
  closeSessionSchema,
  submitBaselineSchema,
  analyzeSchema,
  resolveQueueSchema,
  paginationSchema,
  listSubmissionsQuery,
};
