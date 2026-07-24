import { getRedis } from '../config/redis';
import { logger } from '../config/logger';

// Redis sorted set key
const LEADERBOARD_KEY = 'leaderboard';
const USER_AP_KEY = (userId: string) => `user:ap:${userId}`;
const USER_META_KEY = (userId: string) => `user:meta:${userId}`;
const USER_LASTSUBMIT_KEY = (userId: string) => `user:lastsubmit:${userId}`;

export interface LeaderboardEntry {
  userId: string;
  name: string;
  rollNumber: string;
  ap: number;
  rank: number;
  problemsSolved: number;
  currentProblemTitle?: string;
  lastSubmitTime?: number;
}

/**
 * Update a user's AP in the Redis sorted set.
 * Also stores last submission timestamp (used as tie-breaker).
 */
export async function updateLeaderboardScore(
  userId: string,
  ap: number,
  meta?: { name?: string; rollNumber?: string; problemsSolved?: number; lastSubmitTime?: number; currentProblemTitle?: string }
): Promise<void> {
  const redis = getRedis();
  const pipeline = redis.pipeline();

  // Update sorted set (ZADD overwrites existing score)
  pipeline.zadd(LEADERBOARD_KEY, ap, userId);

  // Update AP key for quick reads
  pipeline.set(USER_AP_KEY(userId), ap.toString());

  // Update user metadata
  if (meta) {
    const existing = await redis.get(USER_META_KEY(userId));
    const current = existing ? JSON.parse(existing) : {};
    pipeline.set(USER_META_KEY(userId), JSON.stringify({ ...current, ...meta }));
  }

  if (meta?.lastSubmitTime) {
    pipeline.set(USER_LASTSUBMIT_KEY(userId), meta.lastSubmitTime.toString());
  }

  await pipeline.exec();
}

/**
 * Get top N users from leaderboard.
 * Applies tie-breaker: equal AP → earlier last submission wins (more time remaining).
 */
export async function getTopN(n: number = 10): Promise<LeaderboardEntry[]> {
  const redis = getRedis();

  // Get top N*2 to have room for tie-breaking
  const results = await redis.zrevrange(LEADERBOARD_KEY, 0, n * 2 - 1, 'WITHSCORES');

  const entries: LeaderboardEntry[] = [];
  for (let i = 0; i < results.length; i += 2) {
    const userId = results[i];
    const ap = parseFloat(results[i + 1]);
    const meta = await redis.get(USER_META_KEY(userId));
    const metaObj = meta ? JSON.parse(meta) : {};

    entries.push({
      userId,
      ap,
      name: metaObj.name || 'Unknown',
      rollNumber: metaObj.rollNumber || '',
      rank: 0, // computed below
      problemsSolved: metaObj.problemsSolved || 0,
      currentProblemTitle: metaObj.currentProblemTitle,
      lastSubmitTime: metaObj.lastSubmitTime,
    });
  }

  // Sort: by AP desc, then by lastSubmitTime asc (earlier = more time remaining = higher rank)
  entries.sort((a, b) => {
    if (b.ap !== a.ap) return b.ap - a.ap;
    const aTime = a.lastSubmitTime || Infinity;
    const bTime = b.lastSubmitTime || Infinity;
    return aTime - bTime; // earlier submission = more time remaining = better rank
  });

  return entries.slice(0, n).map((e, idx) => ({ ...e, rank: idx + 1 }));
}

/**
 * Get a user's current rank (1-indexed).
 */
export async function getUserRank(userId: string): Promise<number> {
  const redis = getRedis();
  const rank = await redis.zrevrank(LEADERBOARD_KEY, userId);
  return rank !== null ? rank + 1 : 0;
}

/**
 * Get a user's current AP from Redis (fast path, no DB round-trip).
 */
export async function getUserAP(userId: string): Promise<number> {
  const redis = getRedis();
  const ap = await redis.get(USER_AP_KEY(userId));
  return ap ? parseFloat(ap) : 0;
}

/**
 * Get combined AP total across all participants (for the per-student personal view).
 */
export async function getCombinedTotal(): Promise<number> {
  const redis = getRedis();
  // Iterate through all leaderboard members and sum scores
  const all = await redis.zrange(LEADERBOARD_KEY, 0, -1, 'WITHSCORES');
  let total = 0;
  for (let i = 1; i < all.length; i += 2) {
    total += parseFloat(all[i]);
  }
  return total;
}

/**
 * Get total number of participants on leaderboard.
 */
export async function getParticipantCount(): Promise<number> {
  const redis = getRedis();
  return redis.zcard(LEADERBOARD_KEY);
}

/**
 * Register a user's metadata to the leaderboard (on first connect).
 */
export async function registerUser(
  userId: string,
  name: string,
  rollNumber: string
): Promise<void> {
  const redis = getRedis();
  const existing = await redis.get(USER_META_KEY(userId));
  if (!existing) {
    await redis.set(USER_META_KEY(userId), JSON.stringify({ name, rollNumber, problemsSolved: 0 }));
    // Add with 0 AP so they appear on leaderboard from the start
    await redis.zadd(LEADERBOARD_KEY, 0, userId);
  }
  logger.debug('User registered on leaderboard', { userId, name });
}

/**
 * Get all users from the leaderboard (for admin monitoring table).
 * Returns in rank order. Fetches metadata from Redis — no TiDB round-trip.
 */
export async function getAllUsers(): Promise<LeaderboardEntry[]> {
  const redis = getRedis();
  const results = await redis.zrevrange(LEADERBOARD_KEY, 0, -1, 'WITHSCORES');

  const pipeline = redis.pipeline();
  const userIds: string[] = [];
  const scores: number[] = [];

  for (let i = 0; i < results.length; i += 2) {
    userIds.push(results[i]);
    scores.push(parseFloat(results[i + 1]));
    pipeline.get(USER_META_KEY(results[i]));
  }

  const metas = await pipeline.exec();
  if (!metas) return [];

  return userIds.map((userId, idx) => {
    const meta = metas[idx]?.[1] ? JSON.parse(metas[idx][1] as string) : {};
    return {
      userId,
      ap: scores[idx],
      name: meta.name || 'Unknown',
      rollNumber: meta.rollNumber || '',
      rank: idx + 1,
      problemsSolved: meta.problemsSolved || 0,
      currentProblemTitle: meta.currentProblemTitle,
      lastSubmitTime: meta.lastSubmitTime,
    };
  });
}
