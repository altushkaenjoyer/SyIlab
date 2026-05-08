'use strict';

const { Queue } = require('bullmq');
const env = require('./env');

const connection = { url: env.REDIS_URL };

const emailQueue = new Queue('emails', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

async function enqueueEmail(type, payload) {
  await emailQueue.add(type, payload, { jobId: `${type}-${Date.now()}-${Math.random().toString(36).slice(2)}` });
}

module.exports = { emailQueue, enqueueEmail };
