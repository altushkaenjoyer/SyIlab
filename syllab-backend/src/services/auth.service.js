'use strict';

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../config/env');
const { getClient } = require('../config/database');

const BCRYPT_ROUNDS = 12;

// ── Password ───────────────────────────────────────────────────────────────

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// ── JWT ────────────────────────────────────────────────────────────────────

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN, algorithm: 'HS256' }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    { sub: user.id, type: 'refresh' },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN, algorithm: 'HS256' }
  );
}

function verifyRefreshToken(token) {
  return jwt.verify(token, env.JWT_REFRESH_SECRET);
}

// ── Refresh token storage ─────────────────────────────────────────────────

async function storeRefreshToken(userId, rawToken) {
  const prisma = getClient();
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const decoded = jwt.decode(rawToken);
  const expiresAt = new Date(decoded.exp * 1000);

  await prisma.refreshToken.create({
    data: { userId, tokenHash, expiresAt },
  });

  return tokenHash;
}

async function revokeRefreshToken(rawToken) {
  const prisma = getClient();
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function validateStoredRefreshToken(rawToken) {
  const prisma = getClient();
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, email: true, role: true } } },
  });

  if (!stored) throw Object.assign(new Error('Refresh token not found'), { status: 401 });
  if (stored.revokedAt) throw Object.assign(new Error('Refresh token has been revoked'), { status: 401 });
  if (stored.expiresAt < new Date()) throw Object.assign(new Error('Refresh token has expired'), { status: 401 });

  return stored.user;
}

// ── Registration ───────────────────────────────────────────────────────────

async function register({ email, password, full_name: fullName, role }) {
  const prisma = getClient();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw Object.assign(new Error('Email already in use'), { status: 409, code: 'EMAIL_TAKEN' });
  }

  const passwordHash = await hashPassword(password);
  const verificationToken = crypto.randomBytes(32).toString('hex');

  const user = await prisma.user.create({
    data: { email, passwordHash, fullName, role: role || 'STUDENT', verificationToken },
    select: { id: true, email: true, fullName: true, role: true, createdAt: true, verificationToken: true },
  });

  return user;
}

// ── Email verification ─────────────────────────────────────────────────────

async function verifyEmail(token) {
  const prisma = getClient();

  const user = await prisma.user.findFirst({ where: { verificationToken: token } });
  if (!user) {
    throw Object.assign(new Error('Invalid or expired verification token'), { status: 400, code: 'INVALID_TOKEN' });
  }
  if (user.emailVerified) {
    throw Object.assign(new Error('Email already verified'), { status: 409, code: 'ALREADY_VERIFIED' });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true, verificationToken: null },
  });

  return { id: user.id, email: user.email };
}

async function resendVerification(email) {
  const prisma = getClient();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return; // don't leak user existence
  if (user.emailVerified) {
    throw Object.assign(new Error('Email already verified'), { status: 409, code: 'ALREADY_VERIFIED' });
  }

  const verificationToken = crypto.randomBytes(32).toString('hex');
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { verificationToken },
    select: { id: true, email: true, fullName: true, verificationToken: true },
  });

  return updated;
}

// ── Password reset ─────────────────────────────────────────────────────────

async function createPasswordResetToken(email) {
  const prisma = getClient();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null; // don't leak user existence

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  // Invalidate previous tokens for this user
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });

  return { rawToken, user };
}

async function resetPassword(rawToken, newPassword) {
  const prisma = getClient();

  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!record) throw Object.assign(new Error('Invalid or expired reset token'), { status: 400, code: 'INVALID_TOKEN' });
  if (record.usedAt) throw Object.assign(new Error('Reset token already used'), { status: 400, code: 'TOKEN_USED' });
  if (record.expiresAt < new Date()) throw Object.assign(new Error('Reset token has expired'), { status: 400, code: 'TOKEN_EXPIRED' });

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
    await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    // Revoke all refresh tokens on password change
    await tx.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });

  return { email: record.user.email };
}

// ── Login ──────────────────────────────────────────────────────────────────

async function login({ email, password }) {
  const prisma = getClient();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw Object.assign(new Error('Invalid credentials'), { status: 401, code: 'INVALID_CREDENTIALS' });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    throw Object.assign(new Error('Invalid credentials'), { status: 401, code: 'INVALID_CREDENTIALS' });
  }

  if (!user.emailVerified) {
    throw Object.assign(new Error('Email not verified. Please check your inbox.'), { status: 403, code: 'EMAIL_NOT_VERIFIED' });
  }

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  await storeRefreshToken(user.id, refreshToken);

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 86400,
    user: { id: user.id, email: user.email, full_name: user.fullName, role: user.role },
  };
}

// ── Refresh ────────────────────────────────────────────────────────────────

async function refreshAccessToken(rawRefreshToken) {
  // Verify JWT signature + expiry first
  try {
    verifyRefreshToken(rawRefreshToken);
  } catch {
    throw Object.assign(new Error('Invalid refresh token'), { status: 401 });
  }

  // Then validate against DB (revocation check)
  const user = await validateStoredRefreshToken(rawRefreshToken);
  const accessToken = signAccessToken(user);

  return { access_token: accessToken, expires_in: 86400 };
}

module.exports = {
  hashPassword,
  verifyPassword,
  register,
  verifyEmail,
  resendVerification,
  createPasswordResetToken,
  resetPassword,
  login,
  refreshAccessToken,
  revokeRefreshToken,
  signAccessToken,
};
