'use strict';

const authService = require('../services/auth.service');
const { enqueueEmail } = require('../config/queue');
const { getClient } = require('../config/database');

async function register(req, res, next) {
  try {
    const user = await authService.register(req.body);

    // Fire-and-forget — never block registration if queue is temporarily down
    enqueueEmail('verification', {
      to: user.email,
      fullName: user.fullName,
      token: user.verificationToken,
    }).catch(err => console.error('[register] Failed to enqueue verification email:', err.message));

    return res.status(201).json({
      data: {
        id: user.id,
        email: user.email,
        full_name: user.fullName,
        role: user.role,
        created_at: user.createdAt,
      },
      message: 'Registration successful. Please check your email to verify your account.',
    });
  } catch (err) {
    next(err);
  }
}

async function verifyEmail(req, res, next) {
  try {
    const { token } = req.body;
    const result = await authService.verifyEmail(token);
    return res.status(200).json({ data: result, message: 'Email verified successfully. You can now log in.' });
  } catch (err) {
    next(err);
  }
}

async function resendVerification(req, res, next) {
  try {
    const { email } = req.body;
    const user = await authService.resendVerification(email);

    if (user) {
      enqueueEmail('verification', {
        to: user.email,
        fullName: user.fullName,
        token: user.verificationToken,
      }).catch(err => console.error('[resend] Failed to enqueue email:', err.message));
    }

    // Always respond 200 to prevent email enumeration
    return res.status(200).json({ message: 'If that email is registered and unverified, a new verification link has been sent.' });
  } catch (err) {
    if (err.code === 'ALREADY_VERIFIED') {
      return res.status(409).json({ error: 'ALREADY_VERIFIED', message: err.message, status: 409 });
    }
    next(err);
  }
}

async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    const result = await authService.createPasswordResetToken(email);

    if (result) {
      enqueueEmail('password-reset', {
        to: result.user.email,
        fullName: result.user.fullName,
        token: result.rawToken,
      }).catch(err => console.error('[forgot-password] Failed to enqueue email:', err.message));
    }

    // Always respond 200 to prevent email enumeration
    return res.status(200).json({ message: 'If that email is registered, a password reset link has been sent.' });
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const { token, new_password } = req.body;
    const result = await authService.resetPassword(token, new_password);
    return res.status(200).json({ data: { email: result.email }, message: 'Password reset successfully. Please log in with your new password.' });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const result = await authService.login(req.body);
    return res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const { refresh_token } = req.body;
    const result = await authService.refreshAccessToken(refresh_token);
    return res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    const { refresh_token } = req.body;
    if (refresh_token) {
      await authService.revokeRefreshToken(refresh_token);
    }
    return res.status(200).json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
}

async function me(req, res) {
  return res.status(200).json({ data: req.user });
}

// DEV ONLY — никогда не включать в production
async function devGetToken(req, res, next) {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: 'email query param required' });
    }
    const prisma = getClient();
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        email: true,
        emailVerified: true,
        verificationToken: true,
        passwordResetTokens: {
          where: { usedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { tokenHash: true, expiresAt: true },
        },
      },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json({
      email: user.email,
      email_verified: user.emailVerified,
      verification_token: user.verificationToken ?? null,
      reset_token_hash: user.passwordResetTokens[0]?.tokenHash ?? null,
      note: 'reset_token_hash is the SHA-256 hash — the raw token was only in the email. Use forgot-password to get a fresh one.',
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, verifyEmail, resendVerification, forgotPassword, resetPassword, login, refresh, logout, me, devGetToken };
