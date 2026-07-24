import { getRedis } from '../config/redis';
import { prisma } from '../config/database';
import { logger } from '../config/logger';

const DRAFT_KEY = (userId: string, problemId: string) => `draft:${userId}:${problemId}`;
const DRAFT_DIRTY_KEY = (userId: string, problemId: string) => `draft:dirty:${userId}:${problemId}`;
const FLUSH_INTERVAL_MS = 60_000; // flush to TiDB every 60 seconds

/**
 * Save a code draft to Redis (fast, called every 7s from client auto-save).
 * Marks the draft as "dirty" (needs to be flushed to TiDB).
 */
export async function saveDraftToRedis(
  userId: string,
  problemId: string,
  code: string,
  language: string
): Promise<void> {
  const redis = getRedis();
  const key = DRAFT_KEY(userId, problemId);
  const dirtyKey = DRAFT_DIRTY_KEY(userId, problemId);

  const draft = JSON.stringify({ code, language, savedAt: Date.now() });

  // TTL = 4 hours — enough to outlive the contest
  await redis.setex(key, 14400, draft);
  await redis.set(dirtyKey, '1');
}

/**
 * Get a code draft from Redis (for session restore on reconnect).
 */
export async function getDraftFromRedis(
  userId: string,
  problemId: string
): Promise<{ code: string; language: string } | null> {
  const redis = getRedis();
  const raw = await redis.get(DRAFT_KEY(userId, problemId));
  if (!raw) return null;
  const { code, language } = JSON.parse(raw);
  return { code, language };
}

/**
 * Flush all dirty drafts from Redis to TiDB.
 * Called on a periodic timer. Writes only dirty drafts to minimize RU spend.
 * This is also called on graceful shutdown.
 */
export async function flushDirtyDrafts(): Promise<void> {
  const redis = getRedis();

  // Find all dirty draft keys
  const dirtyKeys = await redis.keys('draft:dirty:*');
  if (dirtyKeys.length === 0) return;

  logger.debug(`Flushing ${dirtyKeys.length} dirty drafts to TiDB`);

  for (const dirtyKey of dirtyKeys) {
    try {
      // Extract userId and problemId from key pattern: draft:dirty:{userId}:{problemId}
      const parts = dirtyKey.split(':');
      if (parts.length < 4) continue;

      const userId = parts[2];
      const problemId = parts[3];
      const draftKey = DRAFT_KEY(userId, problemId);

      const raw = await redis.get(draftKey);
      if (!raw) {
        await redis.del(dirtyKey);
        continue;
      }

      const { code, language } = JSON.parse(raw);

      // Upsert draft submission record in TiDB
      // We use a lightweight approach: store as a PENDING submission with no test results
      await prisma.submission.upsert({
        where: {
          // Composite approach: find by userId + problemId + status PENDING
          // Since Prisma requires unique field for upsert, we use a workaround with update many
          id: `draft:${userId}:${problemId}`,
        },
        create: {
          id: `draft:${userId}:${problemId}`,
          userId,
          problemId,
          code,
          language: language.toUpperCase() as any,
          status: 'PENDING',
        },
        update: {
          code,
          language: language.toUpperCase() as any,
        },
      });

      await redis.del(dirtyKey);
    } catch (err) {
      logger.error('Draft flush error', { key: dirtyKey, error: err });
    }
  }
}

/**
 * Start the periodic flush timer.
 */
export function startDraftFlusher(): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      await flushDirtyDrafts();
    } catch (err) {
      logger.error('Draft flusher error', { error: err });
    }
  }, FLUSH_INTERVAL_MS);
}
