import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

declare global {
  // Allow global `var` declarations in TypeScript for singleton
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient() {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  });
}

// Singleton pattern — prevents multiple instances in hot-reload dev mode
export const prisma = global.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

export async function connectDatabase() {
  try {
    await prisma.$connect();
    logger.info('Database connected (TiDB Serverless via Prisma)');
  } catch (err) {
    logger.error('Database connection failed', { error: err });
    throw err;
  }
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
}
