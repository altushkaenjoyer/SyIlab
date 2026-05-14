# SylLab-Forensics

> Code Authorship Verification Platform — detects uncharacteristic sophistication jumps in student submissions.

**Philosophy:** Not "AI vs Human" but "consistent progression vs. unnatural escalation." See [SCORING_RUBRIC.md](./SCORING_RUBRIC.md).

---

## Quick Start (Docker)

```bash
# 1. Clone and configure
cp .env.example .env
# Edit .env — fill in JWT secrets, ENCRYPTION_KEY, and SMTP credentials

# 2. Run everything (Postgres + Redis + App)
docker compose up

# App:    http://localhost:3000
# Docs:   http://localhost:3000/docs
# Health: http://localhost:3000/health
```

---

## Manual Setup (without Docker)

### Prerequisites
- Node.js 20+
- PostgreSQL 15
- Redis 7

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Fill in: DATABASE_URL, REDIS_URL, JWT secrets, ENCRYPTION_KEY, SMTP_*

# 3. Run database migrations
npm run db:migrate:dev

# 4. Generate Prisma client
npm run db:generate

# 5. (Optional) Seed with test data
npm run db:seed

# 6. Start the API server (terminal 1)
npm run dev

# 7. Start the email worker (terminal 2)
npm run worker:dev
```

---

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Express.js (Node.js 20) |
| ORM | Prisma 5 |
| Database | PostgreSQL 15 |
| Cache / Queue / Rate limiting | Redis 7 + BullMQ |
| Auth | JWT (access 24h + refresh 30d) + bcrypt (cost 12) |
| Email | Nodemailer (async via BullMQ worker) |
| Validation | Zod |
| API Docs | Swagger UI at `/docs` |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✓ | PostgreSQL connection string |
| `REDIS_URL` | ✓ | Redis connection string |
| `JWT_ACCESS_SECRET` | ✓ | Min 32 chars |
| `JWT_REFRESH_SECRET` | ✓ | Min 32 chars |
| `ENCRYPTION_KEY` | ✓ | Exactly 32 chars (AES-256) |
| `ALLOWED_ORIGINS` | ✓ | Comma-separated CORS origins |
| `APP_URL` | ✓ | Base URL for email links (e.g. http://localhost:3000) |
| `SMTP_HOST` | ✓ | SMTP server (e.g. smtp.gmail.com) |
| `SMTP_PORT` | ✓ | Usually 587 |
| `SMTP_USER` | ✓ | SMTP login (Gmail address) |
| `SMTP_PASS` | ✓ | SMTP password (Gmail App Password) |
| `FROM_EMAIL` | ✓ | Sender address shown in emails |
| `GEMINI_API_KEY` | optional | For LLM explanation generation |
| `PORT` | optional | Default 3000 |

App **refuses to start** if any required variable is missing or malformed.

---

## Auth Flow

```
POST /auth/register            → create account (sends verification email)
POST /auth/verify-email        → activate account with token from email
POST /auth/resend-verification → resend verification email
POST /auth/login               → access_token (24h) + refresh_token (30d)
GET  /auth/me                  → current user info (requires Bearer token)
POST /auth/refresh             → new access_token
POST /auth/logout              → revoke refresh token
POST /auth/forgot-password     → send password reset link to email
POST /auth/reset-password      → set new password using token from email
```

**Roles:** `STUDENT` / `INSTRUCTOR` / `PROCTOR` / `ADMIN`

- Unverified users → `403 EMAIL_NOT_VERIFIED` on all protected routes
- Wrong role → `403 FORBIDDEN`
- Rate limiting: 5 req/min per IP on register, login, resend, forgot-password

---

## Core Business Flow

```
# Week 1 — Proctored baseline
POST  /sessions                      ← INSTRUCTOR creates session
PATCH /sessions/:id/open             ← INSTRUCTOR/PROCTOR opens session
POST  /sessions/:id/baseline         ← STUDENT submits baseline code
PATCH /sessions/:id/close            ← INSTRUCTOR closes session

# Weeks 2–15 — Submission analysis
POST  /submissions/analyze           ← STUDENT submits code, gets ensemble score + flag

# Instructor review queue
GET   /instructor/queue              ← prioritized flagged submissions
GET   /instructor/queue/:id          ← full details + breakdown
PATCH /instructor/queue/:id/resolve  ← mark REVIEWED / CLEARED / CONFIRMED
```

---

## Email Notifications (3 business events)

| Event | Trigger | Recipient |
|-------|---------|-----------|
| Email verification | Registration | Student |
| Password reset | Forgot-password request | Student |
| Submission flagged | Score ≥ REVIEW threshold | Instructor |

All emails are sent **asynchronously** via BullMQ — API endpoints return immediately.

---

## Background Worker

```bash
npm run worker        # production
npm run worker:dev    # development (auto-restart)
```

The worker processes the `emails` Redis queue with:
- 3 retry attempts with exponential backoff (5s, 10s, 20s)
- Concurrency: 5 parallel email jobs
- Keeps last 100 completed / 200 failed jobs visible in Redis

---

## Scoring Formula

See [SCORING_RUBRIC.md](./SCORING_RUBRIC.md) for full documentation.

```
score = clamp01(base × (1 + boost) × consecutive_mult)

base  = 0.22×C1 + 0.30×C2 + 0.22×C3 + 0.14×C4 + 0.06×C5 + 0.06×C6
boost = 0.40 × (corroborating_signals / 3)
```

| Score | Flag |
|-------|------|
| < 0.27 | NORMAL |
| 0.27–0.49 | MONITOR |
| 0.50–0.64 | REVIEW |
| ≥ 0.65 | INTERVIEW |

---

## Running Tests

```bash
# Unit tests (no DB/Redis needed)
npm run test:unit

# Integration tests (requires running Postgres + Redis)
npm run test:integration

# All tests
npm test

# Integration tests with custom DB
DATABASE_URL="postgresql://syllab:syllab_pass@localhost:5433/syllab_test" npm run test:integration
```

---

## Project Structure

```
src/
├── config/         env.js, database.js, redis.js, queue.js
├── controllers/    auth, sessions, submissions, queue
├── middleware/     auth (authenticate + requireVerified), rbac, rateLimit, validate, errorHandler
├── routes/         auth, sessions, submissions, queue
├── services/       auth, email, scoring, astExtractor, genealogy, encryption
├── utils/          pagination
├── validators/     schemas.js (Zod)
└── app.js / server.js

workers/
└── email.worker.js   (BullMQ — processes "emails" queue)

prisma/
├── schema.prisma
├── seed.js
└── migrations/

tests/
├── unit/           scoring.test.js
└── integration/    auth.test.js
```

---

## Architecture Decisions

**Why Express over FastAPI?** Chosen in Week 1 per project requirements.

**Why Prisma?** Type-safe ORM with migration history. Zero raw SQL queries.

**Email is async.** API endpoints enqueue email jobs via BullMQ and return immediately. The worker runs as a separate process, retries on failure, and never blocks the request lifecycle.

**Baseline immutability** enforced at two layers:
1. Prisma middleware (application layer)
2. PostgreSQL trigger `baseline_lock_guard` (database layer)

**Scoring formula** uses student-specific z-scores (not universal thresholds) to implement "prove NOT YOU" principle. Perplexity and burstiness explicitly excluded — see SCORING_RUBRIC.md.

**Rate limiting** uses Redis token bucket via `rate-limiter-flexible` (not in-memory) so it works across multiple app instances.

**Password reset** invalidates all refresh tokens on success — forces re-login on all devices after a password change.
