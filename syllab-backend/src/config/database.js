'use strict';

const { PrismaClient } = require('@prisma/client');
const env = require('./env');

let prisma;

function getClient() {
  if (!prisma) {
    prisma = new PrismaClient({
      log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });

    // Middleware: enforce baseline immutability at application layer
    // Belt-and-suspenders alongside the DB trigger
    prisma.$use(async (params, next) => {
      if (
        params.model === 'BaselineSession' &&
        (params.action === 'update' || params.action === 'updateMany')
      ) {
        const existing = await prisma.baselineSession.findFirst({
          where: params.args.where,
          select: { lockedAt: true, id: true },
        });
        if (existing?.lockedAt) {
          throw new Error(
            `BASELINE_LOCKED: baseline_session ${existing.id} is locked and cannot be modified`
          );
        }
      }
      return next(params);
    });
  }
  return prisma;
}

async function disconnect() {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}

module.exports = { getClient, disconnect };
