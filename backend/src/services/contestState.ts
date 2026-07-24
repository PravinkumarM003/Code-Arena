import { getRedis } from '../config/redis';
import { logger } from '../config/logger';

// ─── Contest State Types ────────────────────────────────────────────────────

export type ContestState = 'WAITING' | 'RUNNING' | 'PAUSED' | 'ENDED';

// Redis keys
const KEYS = {
  STATE: 'contest:state',
  END_TIME: 'contest:end_time',
  START_TIME: 'contest:start_time',
  PAUSED_AT: 'contest:paused_at',
  ELAPSED_MS: 'contest:elapsed_ms',       // ms elapsed before last pause
  CONNECTED_COUNT: 'contest:connected',
  DIFFICULTY_CURVE: 'contest:difficulty_curve',
  ANNOUNCEMENT: 'contest:announcement',
  LEADERBOARD: 'leaderboard',
  INFRA_STATS: 'contest:infra_stats',
} as const;

// ─── State Machine ──────────────────────────────────────────────────────────

export async function getContestState(): Promise<ContestState> {
  const redis = getRedis();
  const state = await redis.get(KEYS.STATE);
  return (state as ContestState) || 'WAITING';
}

export async function setContestState(state: ContestState): Promise<void> {
  const redis = getRedis();
  await redis.set(KEYS.STATE, state);
  logger.info('Contest state changed', { state });
}

// ─── Time Management ────────────────────────────────────────────────────────

export async function startContest(durationMinutes: number): Promise<number> {
  const redis = getRedis();
  const now = Date.now();
  const endTime = now + durationMinutes * 60 * 1000;

  await redis.set(KEYS.STATE, 'RUNNING');
  await redis.set(KEYS.START_TIME, now.toString());
  await redis.set(KEYS.END_TIME, endTime.toString());
  await redis.set(KEYS.ELAPSED_MS, '0');

  logger.info('Contest started', { durationMinutes, endTime: new Date(endTime).toISOString() });
  return endTime;
}

export async function pauseContest(): Promise<{ remainingMs: number }> {
  const redis = getRedis();
  const now = Date.now();
  const endTime = parseInt(await redis.get(KEYS.END_TIME) || '0');
  const remainingMs = Math.max(0, endTime - now);

  await redis.set(KEYS.STATE, 'PAUSED');
  await redis.set(KEYS.PAUSED_AT, now.toString());
  await redis.set(KEYS.ELAPSED_MS, (endTime - now).toString());

  logger.info('Contest paused', { remainingMs });
  return { remainingMs };
}

export async function resumeContest(): Promise<number> {
  const redis = getRedis();
  const now = Date.now();
  const remainingMs = parseInt(await redis.get(KEYS.ELAPSED_MS) || '0');
  const newEndTime = now + remainingMs;

  await redis.set(KEYS.STATE, 'RUNNING');
  await redis.set(KEYS.END_TIME, newEndTime.toString());
  await redis.del(KEYS.PAUSED_AT);

  logger.info('Contest resumed', { newEndTime: new Date(newEndTime).toISOString() });
  return newEndTime;
}

export async function endContest(): Promise<void> {
  const redis = getRedis();
  await redis.set(KEYS.STATE, 'ENDED');
  logger.info('Contest ended');
}

export async function extendContest(extraMinutes: number): Promise<number> {
  const redis = getRedis();
  const state = await getContestState();
  const currentEnd = parseInt(await redis.get(KEYS.END_TIME) || '0');
  const newEnd = currentEnd + extraMinutes * 60 * 1000;
  await redis.set(KEYS.END_TIME, newEnd.toString());

  if (state === 'PAUSED') {
    const currentElapsed = parseInt(await redis.get(KEYS.ELAPSED_MS) || '0');
    await redis.set(KEYS.ELAPSED_MS, (currentElapsed + extraMinutes * 60 * 1000).toString());
  }

  logger.info('Contest extended', { extraMinutes, newEnd: new Date(newEnd).toISOString() });
  return newEnd;
}

export async function getContestTimes(): Promise<{
  state: ContestState;
  endTime: number | null;
  startTime: number | null;
  remainingMs: number;
}> {
  const redis = getRedis();
  const [state, endTimeStr, startTimeStr] = await redis.mget(
    KEYS.STATE,
    KEYS.END_TIME,
    KEYS.START_TIME
  );

  const endTime = endTimeStr ? parseInt(endTimeStr) : null;
  const startTime = startTimeStr ? parseInt(startTimeStr) : null;
  const remainingMs = endTime ? Math.max(0, endTime - Date.now()) : 0;

  return {
    state: (state as ContestState) || 'WAITING',
    endTime,
    startTime,
    remainingMs,
  };
}

// ─── Connection Counter ──────────────────────────────────────────────────────

export async function incrementConnected(): Promise<number> {
  const redis = getRedis();
  return redis.incr(KEYS.CONNECTED_COUNT);
}

export async function decrementConnected(): Promise<number> {
  const redis = getRedis();
  const val = await redis.decr(KEYS.CONNECTED_COUNT);
  return Math.max(0, val);
}

export async function getConnectedCount(): Promise<number> {
  const redis = getRedis();
  const val = await redis.get(KEYS.CONNECTED_COUNT);
  return parseInt(val || '0');
}

// ─── Announcements ───────────────────────────────────────────────────────────

export async function setAnnouncement(message: string): Promise<void> {
  const redis = getRedis();
  await redis.set(KEYS.ANNOUNCEMENT, JSON.stringify({ message, timestamp: Date.now() }));
}

export async function getAnnouncement(): Promise<{ message: string; timestamp: number } | null> {
  const redis = getRedis();
  const raw = await redis.get(KEYS.ANNOUNCEMENT);
  return raw ? JSON.parse(raw) : null;
}

// ─── Difficulty Curve Config ─────────────────────────────────────────────────

export interface DifficultyCurve {
  easyUpTo: number;   // problems 1-N are Easy
  mediumUpTo: number; // problems N+1 to M are Medium
  // beyond M → Hard
}

export async function getDifficultyCurve(): Promise<DifficultyCurve> {
  const redis = getRedis();
  const raw = await redis.get(KEYS.DIFFICULTY_CURVE);
  if (raw) return JSON.parse(raw);
  return { easyUpTo: 2, mediumUpTo: 4 }; // default
}

export async function setDifficultyCurve(curve: DifficultyCurve): Promise<void> {
  const redis = getRedis();
  await redis.set(KEYS.DIFFICULTY_CURVE, JSON.stringify(curve));
}

// ─── Infra Stats ─────────────────────────────────────────────────────────────

export async function updateInfraStats(stats: Record<string, unknown>): Promise<void> {
  const redis = getRedis();
  const existing = await redis.get(KEYS.INFRA_STATS);
  const current = existing ? JSON.parse(existing) : {};
  await redis.set(KEYS.INFRA_STATS, JSON.stringify({ ...current, ...stats, updatedAt: Date.now() }));
}

export async function getInfraStats(): Promise<Record<string, unknown>> {
  const redis = getRedis();
  const raw = await redis.get(KEYS.INFRA_STATS);
  return raw ? JSON.parse(raw) : {};
}
