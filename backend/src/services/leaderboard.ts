import { getRedis } from '../config/redis';
import { logger } from '../config/logger';

// Redis sorted set keys
// Per-event: leaderboard:event:{eventId}
// Overall (sum across all events): leaderboard:overall
const EVENT_LEADERBOARD_KEY = (eventId: string) => `leaderboard:event:${eventId}`;
const OVERALL_LEADERBOARD_KEY = 'leaderboard:overall';

// Per-event AP key
const EVENT_AP_KEY = (eventId: string, userId: string) => `user:ap:event:${eventId}:${userId}`;
const OVERALL_AP_KEY = (userId: string) => `user:ap:overall:${userId}`;
const USER_META_KEY = (userId: string) => `user:meta:${userId}`;
const USER_LASTSUBMIT_KEY = (userId: string) => `user:lastsubmit:${userId}`;

// Legacy overall key (kept for backward compat during migration)
const LEGACY_AP_KEY = (userId: string) => `user:ap:${userId}`;

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

// ─── Score Updates ────────────────────────────────────────────────────────────

/**
 * Update a user's AP for a specific event AND the overall leaderboard.
 * apAwarded = the DELTA earned this submission (already de-duplicated in grading.ts).
 */
export async function updateLeaderboardScore(
  userId: string,
  newEventAP: number,         // total AP for this user in this event (absolute)
  eventId: string,            // which event
  overallDelta: number,       // how much to ADD to overall (the delta, not absolute)
  meta?: {
    name?: string;
    rollNumber?: string;
    problemsSolved?: number;
    lastSubmitTime?: number;
    currentProblemTitle?: string;
  }
): Promise<void> {
  const redis = getRedis();
  const pipeline = redis.pipeline();

  // Per-event leaderboard
  pipeline.zadd(EVENT_LEADERBOARD_KEY(eventId), newEventAP, userId);
  pipeline.set(EVENT_AP_KEY(eventId, userId), newEventAP.toString());

  // Overall leaderboard (increment by delta)
  pipeline.zadd(OVERALL_LEADERBOARD_KEY, overallDelta, userId); // this will ADD to existing score
  const currentOverall = parseFloat(await redis.get(OVERALL_AP_KEY(userId)) || '0');
  const newOverall = currentOverall + overallDelta;
  pipeline.set(OVERALL_AP_KEY(userId), newOverall.toString());

  // Update user metadata (name, rollNumber etc.)
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
 * Used by admin override (ADJUST_AP) — adjusts per-event and overall AP by a delta.
 * eventId is optional — if not given, adjusts overall only.
 */
export async function adjustLeaderboardScore(
  userId: string,
  apDelta: number,
  eventId?: string
): Promise<void> {
  const redis = getRedis();
  const pipeline = redis.pipeline();

  if (eventId) {
    const currentEvent = parseFloat(await redis.get(EVENT_AP_KEY(eventId, userId)) || '0');
    const newEvent = Math.max(0, currentEvent + apDelta);
    pipeline.zadd(EVENT_LEADERBOARD_KEY(eventId), newEvent, userId);
    pipeline.set(EVENT_AP_KEY(eventId, userId), newEvent.toString());
  }

  // Adjust overall
  const currentOverall = parseFloat(await redis.get(OVERALL_AP_KEY(userId)) || '0');
  const newOverall = Math.max(0, currentOverall + apDelta);
  pipeline.zadd(OVERALL_LEADERBOARD_KEY, newOverall, userId);  // ZADD replaces score
  // Actually for overall we need to set absolute value:
  pipeline.set(OVERALL_AP_KEY(userId), newOverall.toString());

  await pipeline.exec();
}

// ─── Leaderboard Reads ────────────────────────────────────────────────────────

/**
 * Get top N from a specific event leaderboard.
 */
export async function getTopNByEvent(eventId: string, n: number = 50): Promise<LeaderboardEntry[]> {
  const redis = getRedis();
  const results = await redis.zrevrange(EVENT_LEADERBOARD_KEY(eventId), 0, n * 2 - 1, 'WITHSCORES');
  return _buildEntries(redis, results, n, (userId) => EVENT_AP_KEY(eventId, userId));
}

/**
 * Get top N from the overall leaderboard (sum across all events).
 */
export async function getTopNOverall(n: number = 50): Promise<LeaderboardEntry[]> {
  const redis = getRedis();
  const results = await redis.zrevrange(OVERALL_LEADERBOARD_KEY, 0, n * 2 - 1, 'WITHSCORES');
  return _buildEntries(redis, results, n, OVERALL_AP_KEY);
}

/**
 * Legacy / backward compat: get top N from the old global leaderboard key.
 * Falls back to event leaderboard when eventId is passed.
 */
export async function getTopN(n: number = 10, eventId?: string | null): Promise<LeaderboardEntry[]> {
  if (eventId) return getTopNByEvent(eventId, n);
  return getTopNOverall(n);
}

/**
 * Shared helper: build sorted leaderboard entries from Redis zrevrange results.
 */
async function _buildEntries(
  redis: ReturnType<typeof getRedis>,
  results: string[],
  n: number,
  apKeyFn: (userId: string) => string
): Promise<LeaderboardEntry[]> {
  const userIds: string[] = [];
  const scores: number[] = [];
  const pipeline = redis.pipeline();

  for (let i = 0; i < results.length; i += 2) {
    userIds.push(results[i]);
    scores.push(parseFloat(results[i + 1]));
    pipeline.get(USER_META_KEY(results[i]));
  }

  const metas = await pipeline.exec();

  const entries: LeaderboardEntry[] = userIds.map((userId, idx) => {
    const metaRaw = metas?.[idx]?.[1] as string | null;
    const metaObj = metaRaw ? JSON.parse(metaRaw) : {};
    return {
      userId,
      ap: scores[idx],
      name: metaObj.name || 'Unknown',
      rollNumber: metaObj.rollNumber || '',
      rank: 0,
      problemsSolved: metaObj.problemsSolved || 0,
      currentProblemTitle: metaObj.currentProblemTitle,
      lastSubmitTime: metaObj.lastSubmitTime,
    };
  });

  // Sort by AP desc, tie-break by lastSubmitTime asc (earlier = better)
  entries.sort((a, b) => {
    if (b.ap !== a.ap) return b.ap - a.ap;
    const aTime = a.lastSubmitTime || Infinity;
    const bTime = b.lastSubmitTime || Infinity;
    return aTime - bTime;
  });

  return entries.slice(0, n).map((e, idx) => ({ ...e, rank: idx + 1 }));
}

// ─── Per-User Reads ───────────────────────────────────────────────────────────

/**
 * Get a user's rank in a specific event leaderboard.
 */
export async function getUserRankByEvent(userId: string, eventId: string): Promise<number> {
  const redis = getRedis();
  const rank = await redis.zrevrank(EVENT_LEADERBOARD_KEY(eventId), userId);
  return rank !== null ? rank + 1 : 0;
}

/**
 * Get a user's rank in the overall leaderboard.
 */
export async function getUserRankOverall(userId: string): Promise<number> {
  const redis = getRedis();
  const rank = await redis.zrevrank(OVERALL_LEADERBOARD_KEY, userId);
  return rank !== null ? rank + 1 : 0;
}

/**
 * Legacy: get rank (prefers current event, falls back to overall).
 */
export async function getUserRank(userId: string, eventId?: string | null): Promise<number> {
  if (eventId) return getUserRankByEvent(userId, eventId);
  return getUserRankOverall(userId);
}

/**
 * Get a user's AP in a specific event.
 */
export async function getUserAPByEvent(userId: string, eventId: string): Promise<number> {
  const redis = getRedis();
  const ap = await redis.get(EVENT_AP_KEY(eventId, userId));
  // Fall back to legacy key if not found (first event before migration)
  if (!ap) {
    const legacy = await redis.get(LEGACY_AP_KEY(userId));
    return legacy ? parseFloat(legacy) : 0;
  }
  return parseFloat(ap);
}

/**
 * Get a user's overall AP (sum across all events).
 */
export async function getUserAPOverall(userId: string): Promise<number> {
  const redis = getRedis();
  const ap = await redis.get(OVERALL_AP_KEY(userId));
  if (!ap) {
    // Fall back to legacy global key
    const legacy = await redis.get(LEGACY_AP_KEY(userId));
    return legacy ? parseFloat(legacy) : 0;
  }
  return parseFloat(ap);
}

/**
 * Legacy / backward compat: get AP for current event or overall.
 */
export async function getUserAP(userId: string, eventId?: string | null): Promise<number> {
  if (eventId) return getUserAPByEvent(userId, eventId);
  return getUserAPOverall(userId);
}

// ─── Aggregates ───────────────────────────────────────────────────────────────

export async function getCombinedTotal(eventId?: string | null): Promise<number> {
  const redis = getRedis();
  const key = eventId ? EVENT_LEADERBOARD_KEY(eventId) : OVERALL_LEADERBOARD_KEY;
  const all = await redis.zrange(key, 0, -1, 'WITHSCORES');
  let total = 0;
  for (let i = 1; i < all.length; i += 2) {
    total += parseFloat(all[i]);
  }
  return total;
}

export async function getParticipantCount(eventId?: string | null): Promise<number> {
  const redis = getRedis();
  const key = eventId ? EVENT_LEADERBOARD_KEY(eventId) : OVERALL_LEADERBOARD_KEY;
  return redis.zcard(key);
}

// ─── User Registration & Admin Monitor ───────────────────────────────────────

/**
 * Register a user's metadata on first connect.
 * Also seeds them into the overall leaderboard with 0 score if not present.
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
    // Add to overall leaderboard with 0 so they appear from the start
    await redis.zadd(OVERALL_LEADERBOARD_KEY, 'NX', 0, userId); // NX = only if not exists
  }
  logger.debug('User registered on leaderboard', { userId, name });
}

/**
 * Register user in a specific event's leaderboard (when event starts).
 */
export async function registerUserForEvent(userId: string, eventId: string): Promise<void> {
  const redis = getRedis();
  // NX = only add if not already in this event's leaderboard
  await redis.zadd(EVENT_LEADERBOARD_KEY(eventId), 'NX', 0, userId);
}

/**
 * Get all users from the overall leaderboard (for admin monitoring).
 */
export async function getAllUsers(): Promise<LeaderboardEntry[]> {
  const redis = getRedis();
  const results = await redis.zrevrange(OVERALL_LEADERBOARD_KEY, 0, -1, 'WITHSCORES');

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
