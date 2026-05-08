'use strict';

const { RateLimiterRedis } = require('rate-limiter-flexible');
const { getClient } = require('../config/redis');

// Auth endpoints: 5 attempts per minute per IP
const authLimiter = new RateLimiterRedis({
  storeClient: getClient(),
  keyPrefix: 'rl:auth',
  points: 5,
  duration: 60,
  blockDuration: 60,
});

// Submissions: 10 per minute per user
const submissionLimiter = new RateLimiterRedis({
  storeClient: getClient(),
  keyPrefix: 'rl:submission',
  points: 10,
  duration: 60,
});

function makeRateLimitMiddleware(limiter, keyFn) {
  if (process.env.NODE_ENV === 'test') {
    return (_req, _res, next) => next();
  }
  return async (req, res, next) => {
    const key = keyFn ? keyFn(req) : (req.ip || 'unknown');
    try {
      await limiter.consume(key);
      next();
    } catch (rlRes) {
      const retryAfter = Math.ceil(rlRes.msBeforeNext / 1000);
      res.set('Retry-After', retryAfter);
      return res.status(429).json({
        error: 'RATE_LIMITED',
        message: `Too many requests. Retry after ${retryAfter}s`,
        status: 429,
        retry_after: retryAfter,
      });
    }
  };
}

const rateLimitAuth = makeRateLimitMiddleware(
  authLimiter,
  (req) => req.ip || 'unknown'
);

const rateLimitSubmission = makeRateLimitMiddleware(
  submissionLimiter,
  (req) => req.user?.id || req.ip || 'unknown'
);

module.exports = { rateLimitAuth, rateLimitSubmission };
