'use strict';

const nodemailer = require('nodemailer');
const env = require('../config/env');

let _transporter = null;

function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  }
  return _transporter;
}

async function sendMail({ to, subject, html }) {
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"SylLab-Forensics" <${env.FROM_EMAIL}>`,
    to,
    subject,
    html,
  });
}

// ── Email templates ───────────────────────────────────────────────────────────

function sendVerificationEmail(to, { fullName, token }) {
  const link = `${env.APP_URL}/auth/verify-email?token=${token}`;
  return sendMail({
    to,
    subject: 'Verify your SylLab-Forensics account',
    html: `
      <h2>Welcome, ${fullName}!</h2>
      <p>Please verify your email address to activate your account:</p>
      <p><a href="${link}" style="padding:10px 20px;background:#4f46e5;color:white;border-radius:6px;text-decoration:none">
        Verify Email
      </a></p>
      <p>Or paste this link: <code>${link}</code></p>
      <p>This link expires in 24 hours.</p>
    `,
  });
}

function sendPasswordResetEmail(to, { fullName, token }) {
  const link = `${env.APP_URL}/auth/reset-password?token=${token}`;
  return sendMail({
    to,
    subject: 'Reset your SylLab-Forensics password',
    html: `
      <h2>Password Reset Request</h2>
      <p>Hi ${fullName}, we received a request to reset your password.</p>
      <p><a href="${link}" style="padding:10px 20px;background:#dc2626;color:white;border-radius:6px;text-decoration:none">
        Reset Password
      </a></p>
      <p>Or paste this link: <code>${link}</code></p>
      <p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>
    `,
  });
}

function sendSubmissionFlaggedEmail(to, { instructorName, studentName, courseId, submissionId, flagLevel, ensembleScore }) {
  const levelColors = { REVIEW: '#f59e0b', INTERVIEW: '#dc2626' };
  const color = levelColors[flagLevel] || '#6b7280';
  return sendMail({
    to,
    subject: `[SylLab] Submission flagged: ${flagLevel} — ${studentName}`,
    html: `
      <h2>Submission Flagged for Review</h2>
      <p>Hi ${instructorName},</p>
      <p>A student submission has been automatically flagged and added to your review queue.</p>
      <table style="border-collapse:collapse;width:100%;max-width:500px">
        <tr><td style="padding:8px;font-weight:bold">Student</td><td style="padding:8px">${studentName}</td></tr>
        <tr><td style="padding:8px;font-weight:bold">Course ID</td><td style="padding:8px">${courseId}</td></tr>
        <tr><td style="padding:8px;font-weight:bold">Submission ID</td><td style="padding:8px">${submissionId}</td></tr>
        <tr><td style="padding:8px;font-weight:bold">Flag Level</td>
            <td style="padding:8px"><span style="color:${color};font-weight:bold">${flagLevel}</span></td></tr>
        <tr><td style="padding:8px;font-weight:bold">Ensemble Score</td><td style="padding:8px">${(ensembleScore * 100).toFixed(1)}%</td></tr>
      </table>
      <p>Log in to your instructor dashboard to review this submission.</p>
    `,
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, sendSubmissionFlaggedEmail };
