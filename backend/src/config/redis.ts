import Redis from 'ioredis';
import { logger } from './logger';

let redisClient: Redis | null = null;

export function getRedis(): Redis {
  if (redisClient) return redisClient;

  let url = process.env.REDIS_URL || 'redis://localhost:6379';

  // Auto-fix if CLI command string was accidentally pasted
  if (url.includes('redis-cli')) {
    const match = url.match(/(rediss?:\/\/[^\s"]+)/);
    if (match) {
      url = match[1];
    }
  }

  const isTls = url.startsWith('rediss://') || url.includes('.upstash.io');

  redisClient = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 100, 3000);
      return delay;
    },
    enableReadyCheck: false,
    lazyConnect: false,
    ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
  });

  redisClient.on('connect', () => logger.info('Redis connected'));
  redisClient.on('error', (err) => logger.error('Redis error', { error: err?.message || String(err) }));
  redisClient.on('reconnecting', () => logger.warn('Redis reconnecting...'));

  return redisClient;
}

export async function closeRedis() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
