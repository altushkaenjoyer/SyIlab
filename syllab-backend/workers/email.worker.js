'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { Worker, QueueEvents } = require('bullmq');
const {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendSubmissionFlaggedEmail,
} = require('../src/services/email.service');
const env = require('../src/config/env');

const connection = { url: env.REDIS_URL };

const worker = new Worker(
  'emails',
  async (job) => {
    console.log(`[email-worker] Processing job ${job.id} type=${job.name}`);

    switch (job.name) {
      case 'verification':
        await sendVerificationEmail(job.data.to, job.data);
        break;
      case 'password-reset':
        await sendPasswordResetEmail(job.data.to, job.data);
        break;
      case 'submission-flagged':
        await sendSubmissionFlaggedEmail(job.data.to, job.data);
        break;
      default:
        throw new Error(`Unknown email job type: ${job.name}`);
    }

    console.log(`[email-worker] Job ${job.id} completed`);
  },
  {
    connection,
    concurrency: 5,
  }
);

worker.on('failed', (job, err) => {
  console.error(`[email-worker] Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`);
});

worker.on('error', (err) => {
  console.error('[email-worker] Worker error:', err.message);
});

console.log('[email-worker] Started, listening on "emails" queue');

// Graceful shutdown
process.on('SIGTERM', async () => {
  await worker.close();
  process.exit(0);
});
