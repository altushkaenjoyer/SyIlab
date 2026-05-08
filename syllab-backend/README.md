# SylLab-Forensics

> Code Authorship Verification Platform — detects uncharacteristic sophistication jumps in student submissions.

**Philosophy:** Not "AI vs Human" but "consistent progression vs. unnatural escalation." See [SCORING_RUBRIC.md](./SCORING_RUBRIC.md).

---

## Quick Start

```bash
# 1. Clone and configure
cp .env.example .env
# Edit .env — set real secrets for JWT and ENCRYPTION_KEY

# 2. Run everything
docker compose up

# App:    http://localhost:3000
# Docs:   http://localhost:3000/docs
# Health: http://localhost:3000/health
```


## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Express.js (Node.js 20) |
| ORM | Prisma 5 |
| Database | PostgreSQL 15 |
| Cache / Rate limiting | Redis 7 |
| Auth | JWT (access 24h + refresh 30d) + bcrypt (cost 12) |
| Validation | Zod |
| API Docs | Swagger UI at `/docs` |


## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✓ | PostgreSQL connection string |
| `REDIS_URL` | ✓ | Redis connection string |
| `JWT_ACCESS_SECRET` | ✓ | Min 32 chars |
| `JWT_REFRESH_SECRET` | ✓ | Min 32 chars |
| `ENCRYPTION_KEY` | ✓ | Exactly 32 chars (AES-256) |
| `ALLOWED_ORIGINS` | ✓ | Comma-separated CORS origins |
| `GEMINI_API_KEY` | optional | For LLM explanation generation |
| `PORT` | optional | Default 3000 |

App **refuses to start** if any required variable is missing.

## Auth Flow

POST /auth/register   → create account
POST /auth/login      → access_token (24h) + refresh_token (30d)
GET  /auth/me         → current user (requires Bearer token)
POST /auth/refresh    → new access_token (refresh_token reusable but revocable)
POST /auth/logout     → invalidate refresh_token
```

**Roles:** `STUDENT` / `INSTRUCTOR` / `PROCTOR` / `ADMIN`

Wrong role → `403 Forbidden` (not 401).

Rate limiting: 5 requests/minute per IP on `/auth/register` and `/auth/login`.


## Core Business Flow
# Week 1 — Proctored baseline (INSTRUCTOR opens session)
PATCH /sessions/:id/open
POST  /sessions/:id/baseline     ← STUDENT submits code in proctored environment

# Weeks 2-15 — Analysis on every submission
POST  /submissions/analyze       ← returns ensemble score + flag level

# Instructor review
GET   /instructor/queue          ← prioritized list of flagged submissions
PATCH /instructor/queue/:id/resolve
```

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
```

---

## Project Structure

```
src/
├── config/         env.js, database.js, redis.js
├── controllers/    auth, sessions, submissions, queue
├── middleware/     auth, rbac, rateLimit, validate, errorHandler
├── routes/         auth, sessions, submissions, queue
├── services/       auth, scoring, astExtractor, genealogy, encryption
├── utils/          pagination
├── validators/     schemas.js (Zod)
└── app.js / server.js

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

**Baseline immutability** enforced at two layers:
1. Prisma middleware (application layer)
2. PostgreSQL trigger `baseline_lock_guard` (database layer)

**Scoring formula** uses student-specific z-scores (not universal thresholds) to implement "prove NOT YOU" principle. Perplexity and burstiness explicitly excluded — see SCORING_RUBRIC.md.

**Rate limiting** uses Redis token bucket via `rate-limiter-flexible` (not in-memory) so it works across multiple app instances.

tests:
npm run test:unit

DATABASE_URL="postgresql://syllab:syllab_pass@localhost:5433/syllab_test" npx jest tests/integration --runInBand --forceExit

