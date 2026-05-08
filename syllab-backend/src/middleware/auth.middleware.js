'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { getClient } = require('../config/database');

function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Missing or malformed Authorization header',
      status: 401,
    });
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  } catch (err) {
    const message =
      err.name === 'TokenExpiredError' ? 'Token has expired' : 'Invalid token';
    return res.status(401).json({ error: 'UNAUTHORIZED', message, status: 401 });
  }
}

// Blocks routes if the user's email is not verified.
// Must be used AFTER authenticate.
async function requireVerified(req, res, next) {
  try {
    const prisma = getClient();
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { emailVerified: true },
    });
    if (!user?.emailVerified) {
      return res.status(403).json({
        error: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your email address before accessing this resource.',
        status: 403,
      });
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { authenticate, requireVerified };
