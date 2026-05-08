'use strict';

process.env.DATABASE_URL   = process.env.DATABASE_URL || 'postgresql://syllab:syllab_pass@localhost:5432/syllab_test';
process.env.REDIS_URL      = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET  = 'test_secret_32_chars_minimum_abcde';
process.env.JWT_REFRESH_SECRET = 'test_refresh_32_chars_minimum_abcd';
process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../../src/app');
const { getClient, disconnect } = require('../../src/config/database');
const { disconnect: disconnectRedis } = require('../../src/config/redis');

let prisma;
let studentToken, instructorToken, refreshTokenStudent;
let studentId, instructorId;

// ── Setup / Teardown ───────────────────────────────────────────────────────

beforeAll(async () => {
  prisma = getClient();
  // Clean test data
  await prisma.auditLog.deleteMany();
  await prisma.instructorQueue.deleteMany();
  await prisma.genealogyViolation.deleteMany();
  await prisma.submissionFeatures.deleteMany();
  await prisma.submission.deleteMany();
  await prisma.baselineFeatures.deleteMany();
  await prisma.baselineSession.deleteMany();
  await prisma.proctoredSession.deleteMany();
  await prisma.enrollment.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany({ where: { email: { contains: '@test-syllab.com' } } });
});

afterAll(async () => {
  await disconnect();
  await disconnectRedis();
});

// ── AUTH TESTS ─────────────────────────────────────────────────────────────

describe('POST /auth/register', () => {
  test('201 — registers new student', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({
        email: 'student@test-syllab.com',
        password: 'Password123',
        full_name: 'Test Student',
        role: 'STUDENT',
      });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.role).toBe('STUDENT');
    expect(res.body.data).not.toHaveProperty('passwordHash');
    studentId = res.body.data.id;
  });

  test('201 — registers instructor', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({
        email: 'instructor@test-syllab.com',
        password: 'Password123',
        full_name: 'Test Instructor',
        role: 'INSTRUCTOR',
      });
    expect(res.status).toBe(201);
    instructorId = res.body.data.id;
  });

  test('409 — duplicate email is rejected', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({
        email: 'student@test-syllab.com',
        password: 'Password123',
        full_name: 'Duplicate',
      });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('EMAIL_TAKEN');
  });

  test('422 — weak password rejected', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'weak@test-syllab.com', password: 'weak', full_name: 'Weak' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  test('422 — invalid email rejected', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'not-an-email', password: 'Password123', full_name: 'Test' });
    expect(res.status).toBe(422);
  });
});

describe('POST /auth/login', () => {
  test('200 — valid credentials return tokens', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'student@test-syllab.com', password: 'Password123' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('access_token');
    expect(res.body.data).toHaveProperty('refresh_token');
    expect(res.body.data.user.role).toBe('STUDENT');
    studentToken = res.body.data.access_token;
    refreshTokenStudent = res.body.data.refresh_token;
  });

  test('200 — instructor login', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'instructor@test-syllab.com', password: 'Password123' });
    expect(res.status).toBe(200);
    instructorToken = res.body.data.access_token;
  });

  test('401 — wrong password', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'student@test-syllab.com', password: 'WrongPassword123' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INVALID_CREDENTIALS');
  });

  test('401 — unknown email', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@test-syllab.com', password: 'Password123' });
    expect(res.status).toBe(401);
  });
});

describe('GET /auth/me', () => {
  test('200 — returns current user with valid token', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${studentToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('STUDENT');
  });

  test('401 — no token', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  test('401 — malformed token', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', 'Bearer not.a.valid.jwt');
    expect(res.status).toBe(401);
  });

  test('401 — tampered token', async () => {
    const tampered = studentToken.slice(0, -5) + 'XXXXX';
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${tampered}`);
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/refresh', () => {
  test('200 — valid refresh token returns new access token', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .send({ refresh_token: refreshTokenStudent });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('access_token');
  });

  test('401 — invalid refresh token', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .send({ refresh_token: 'invalid.refresh.token' });
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  test('200 — logout revokes refresh token', async () => {
    const res = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ refresh_token: refreshTokenStudent });
    expect(res.status).toBe(200);
  });

  test('401 — revoked refresh token cannot be reused', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .send({ refresh_token: refreshTokenStudent });
    expect(res.status).toBe(401);
  });
});

// ── RBAC TESTS ─────────────────────────────────────────────────────────────

describe('RBAC — role enforcement', () => {
  // Re-login student (previous token still valid for access)
  beforeAll(async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'student@test-syllab.com', password: 'Password123' });
    studentToken = res.body.data.access_token;
  });

  test('403 — student cannot create a session (INSTRUCTOR only)', async () => {
    const res = await request(app)
      .post('/sessions')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        course_id: 'fake-course',
        scheduled_at: new Date().toISOString(),
        duration_minutes: 30,
      });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
  });

  test('403 — student cannot access instructor queue', async () => {
    const res = await request(app)
      .get('/instructor/queue')
      .set('Authorization', `Bearer ${studentToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
  });

  test('401 — unauthenticated request to protected route', async () => {
    const res = await request(app).get('/instructor/queue');
    expect(res.status).toBe(401);
  });

  test('401 — expired/invalid token on protected route', async () => {
    const res = await request(app)
      .post('/submissions/analyze')
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.expired.signature')
      .send({ course_id: 'x', week_number: 1, language: 'python', code: 'x=1' });
    expect(res.status).toBe(401);
  });
});

// ── SUBMISSIONS ANALYSIS TESTS ────────────────────────────────────────────

describe('POST /submissions/analyze', () => {
  test('404 — no baseline returns BASELINE_NOT_FOUND', async () => {
    const res = await request(app)
      .post('/submissions/analyze')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        course_id: 'nonexistent-course',
        week_number: 3,
        language: 'python',
        code: 'def hello():\n    print("world")\n',
      });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('BASELINE_NOT_FOUND');
  });

  test('422 — invalid language rejected', async () => {
    const res = await request(app)
      .post('/submissions/analyze')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        course_id: 'course-1',
        week_number: 3,
        language: 'ruby', // not supported
        code: 'puts "hello"',
      });
    expect(res.status).toBe(422);
  });

  test('422 — code too short rejected', async () => {
    const res = await request(app)
      .post('/submissions/analyze')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        course_id: 'course-1',
        week_number: 3,
        language: 'python',
        code: 'x=1', // < 10 chars
      });
    expect(res.status).toBe(422);
  });
});

// ── HEALTH CHECK ───────────────────────────────────────────────────────────

describe('GET /health', () => {
  test('200 — health check returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('404 handler', () => {
  test('404 — unknown route', async () => {
    const res = await request(app).get('/nonexistent-route-xyz');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });
});
