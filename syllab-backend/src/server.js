'use strict';

require('dotenv').config();
const app = require('./app');
const env = require('./config/env');
const { getClient: getPrisma, disconnect: disconnectPrisma } = require('./config/database');
const { getClient: getRedis, disconnect: disconnectRedis } = require('./config/redis');

async function start() {
  // Verify DB connection
  try {
    const prisma = getPrisma();
    await prisma.$queryRaw`SELECT 1`;
    console.log('[DB] PostgreSQL connected');
  } catch (err) {
    console.error('[DB] Failed to connect to PostgreSQL:', err.message);
    process.exit(1);
  }

  // Verify Redis connection
  try {
    const redis = getRedis();
    await redis.ping();
    console.log('[Redis] Connected');
  } catch (err) {
    console.error('[Redis] Failed to connect:', err.message);
    process.exit(1);
  }

  const server = app.listen(env.PORT, () => {
    console.log(`[Server] SylLab-Forensics running on port ${env.PORT}`);
    console.log(`[Docs]   http://localhost:${env.PORT}/docs`);
    console.log(`[Health] http://localhost:${env.PORT}/health`);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n[Server] ${signal} received — shutting down gracefully`);
    server.close(async () => {
      await disconnectPrisma();
      await disconnectRedis();
      console.log('[Server] Shutdown complete');
      process.exit(0);
    });
    // Force exit after 10s
    setTimeout(() => process.exit(1), 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

start();
