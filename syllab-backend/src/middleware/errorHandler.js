'use strict';

const env = require('../config/env');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Baseline locked (from Prisma middleware)
  if (err.message?.startsWith('BASELINE_LOCKED')) {
    return res.status(409).json({
      error: 'BASELINE_LOCKED',
      message: 'This baseline record is locked and cannot be modified',
      status: 409,
    });
  }

  // Prisma unique constraint
  if (err.code === 'P2002') {
    return res.status(409).json({
      error: 'CONFLICT',
      message: 'A record with these values already exists',
      status: 409,
    });
  }

  // Prisma not found
  if (err.code === 'P2025') {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: 'The requested resource was not found',
      status: 404,
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: err.message, status: 401 });
  }

  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';

  if (env.NODE_ENV === 'development') {
    console.error('[Error]', err);
  }

  return res.status(status).json({
    error: err.code || 'INTERNAL_ERROR',
    message: env.NODE_ENV === 'production' && status === 500 ? 'Internal server error' : message,
    status,
  });
}

module.exports = { errorHandler };
