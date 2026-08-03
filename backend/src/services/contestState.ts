import { getRedis } from '../config/redis';
import { logger } from '../config/logger';
import { prisma } from '../config/database';

// ─── Contest State Types ────────────────────────────────────────────────────

export type ContestState = 'WAITING' | 'RUNNING' | 'PAUSED' | 'ENDED';

// Redis keys
const KEYS = {
  STATE: 'contest:state',
  END_TIME: 'contest:end_time',
  START_TIME: 'contest:start_time',
  PAUSED_AT: 'contest:paused_at',
  ELAPSED_MS: 'contest:elapsed_ms',       // ms remaining before last pause
  CONNECTED_COUNT: 'contest:connected',
  DIFFICULTY_CURVE: 'contest:difficulty_curve',
  ANNOUNCEMENT: 'contest:announcement',
  LEADERBOARD: 'leaderboard',
  INFRA_STATS: 'contest:infra_stats',
  CURRENT_EVENT_ID: 'contest:current_event_id',
} as const;

// ─── Event Management ────────────────────────────────────────────────────────

/**
 * Get the currently active event ID from Redis.
 */
export async function getCurrentEventId(): Promise<string | null> {
  const redis = getRedis();
  return redis.get(KEYS.CURRENT_EVENT_ID);
}

/**
 * Set the active event ID in Redis.
 */
export async function setCurrentEventId(eventId: string): Promise<void> {
  const redis = getRedis();
  await redis.set(KEYS.CURRENT_EVENT_ID, eventId);
}

/**
 * Create a new Event record in the DB and set as current.
 * Auto-generates name like "Event 1", "Event 2" if no name given.
 */
export async function createEvent(durationMins: number, name?: string): Promise<string> {
  const count = await prisma.event.count();
  const eventName = name || `Event ${count + 1}`;

  const event = await prisma.event.create({
    data: { name: eventName, state: 'RUNNING', durationMins, startedAt: new Date() },
  });

  await setCurrentEventId(event.id);
  logger.info('Event created', { eventId: event.id, name: eventName });
  return event.id;
}

/**
 * Mark the current event as ENDED in the DB.
 */
export async function endCurrentEvent(): Promise<void> {
  const eventId = await getCurrentEventId();
  if (!eventId) return;
  await prisma.event.update({
    where: { id: eventId },
    data: { state: 'ENDED', endedAt: new Date() },
  }).catch(() => {}); // ignore if already ended
}

/**
 * Hard reset: end current event, create a brand new event with fresh scores.
 * All per-event Redis leaderboard keys for the new event start empty.
 * Returns the new eventId and endTime epoch.
 */
export async function hardReset(durationMins: number, name?: string): Promise<{ eventId: string; endTime: number }> {
  const redis = getRedis();

  // End the previous event in DB
  await endCurrentEvent();

  // Create fresh event record
  const eventId = await createEvent(durationMins, name);

  const now = Date.now();
  const endTime = now + durationMins * 60 * 1000;

  await redis.set(KEYS.STATE, 'RUNNING');
  await redis.set(KEYS.START_TIME, now.toString());
  await redis.set(KEYS.END_TIME, endTime.toString());
  await redis.set(KEYS.ELAPSED_MS, '0');

  logger.info('Hard reset complete', { eventId, durationMins });
  return { eventId, endTime };
}

/**
 * Soft reset: restart timer within the same event, keep all scores.
 * The current event ID stays the same — no new event is created.
 */
export async function softReset(durationMins: number): Promise<number> {
  const redis = getRedis();
  const now = Date.now();
  const endTime = now + durationMins * 60 * 1000;

  await redis.set(KEYS.STATE, 'RUNNING');
  await redis.set(KEYS.START_TIME, now.toString());
  await redis.set(KEYS.END_TIME, endTime.toString());
  await redis.set(KEYS.ELAPSED_MS, '0');

  // Update DB event to running again
  const eventId = await getCurrentEventId();
  if (eventId) {
    await prisma.event.update({
      where: { id: eventId },
      data: { state: 'RUNNING', startedAt: new Date() },
    }).catch(() => {});
  }

  logger.info('Soft reset complete', { durationMins, endTime });
  return endTime;
}

/**
 * Get all past events from the DB (for leaderboard history dropdown).
 */
export async function getEventHistory(): Promise<Array<{
  id: string;
  name: string;
  state: string;
  startedAt: Date | null;
  endedAt: Date | null;
}>> {
  return prisma.event.findMany({
    select: { id: true, name: true, state: true, startedAt: true, endedAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

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

  // Sync DB event state
  const eventId = await getCurrentEventId();
  if (eventId) {
    await prisma.event.update({ where: { id: eventId }, data: { state: 'PAUSED' } }).catch(() => {});
  }

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

  const eventId = await getCurrentEventId();
  if (eventId) {
    await prisma.event.update({ where: { id: eventId }, data: { state: 'RUNNING' } }).catch(() => {});
  }

  logger.info('Contest resumed', { newEndTime: new Date(newEndTime).toISOString() });
  return newEndTime;
}

export async function endContest(): Promise<void> {
  const redis = getRedis();
  await redis.set(KEYS.STATE, 'ENDED');
  await endCurrentEvent();
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

/**
 * Sync the Redis connected counter to the actual live socket count.
 * Call this with io.sockets.sockets.size on each connect/disconnect
 * to keep the count accurate and drift-proof.
 */
export async function syncConnectedCount(liveCount: number): Promise<void> {
  const redis = getRedis();
  await redis.set(KEYS.CONNECTED_COUNT, Math.max(0, liveCount).toString());
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
