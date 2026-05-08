'use strict';

const Redis = require('ioredis');
const env = require('./env');

let client;

function getClient() {
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });

    client.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });

    client.on('connect', () => {
      if (env.NODE_ENV !== 'test') {
        console.log('[Redis] Connected');
      }
    });
  }
  return client;
}

async function disconnect() {
  if (client) {
    await client.quit();
    client = null;
  }
}

module.exports = { getClient, disconnect };
