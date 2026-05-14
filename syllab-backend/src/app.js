'use strict';

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const YAML = require('yaml');
const swaggerUi = require('swagger-ui-express');

const env = require('./config/env'); // validates env on import
const { errorHandler } = require('./middleware/errorHandler');

// Routes
const authRoutes        = require('./routes/auth.routes');
const coursesRoutes     = require('./routes/courses.routes');
const sessionsRoutes    = require('./routes/sessions.routes');
const submissionsRoutes = require('./routes/submissions.routes');
const queueRoutes       = require('./routes/queue.routes');

const app = express();

// ── Security ───────────────────────────────────────────────────────────────

app.use(helmet());
app.set('trust proxy', 1);

// CORS — no wildcard in production
const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow server-to-server
    if (env.NODE_ENV === 'development' || allowedOrigins.includes(origin)) {
      return cb(null, true);
    }
    return cb(new Error(`CORS: Origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
}));

// ── Body parsing ───────────────────────────────────────────────────────────

app.use(compression());
app.use(express.json({ limit: '2mb' }));

// ── Swagger UI ─────────────────────────────────────────────────────────────

const openapiPath = path.join(__dirname, '../openapi.yaml');
if (fs.existsSync(openapiPath)) {
  const openapiDoc = YAML.parse(fs.readFileSync(openapiPath, 'utf8'));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiDoc, {
    customSiteTitle: 'SylLab-Forensics API',
    swaggerOptions: { persistAuthorization: true },
  }));
}

// ── Health check ───────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Routes ─────────────────────────────────────────────────────────────────

app.use('/auth', authRoutes);
app.use('/courses', coursesRoutes);
app.use('/sessions', sessionsRoutes);
app.use('/submissions', submissionsRoutes);
app.use('/instructor/queue', queueRoutes);

// ── 404 ────────────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: `Route ${req.method} ${req.path} not found`,
    status: 404,
  });
});

// ── Global error handler ───────────────────────────────────────────────────

app.use(errorHandler);

module.exports = app;
