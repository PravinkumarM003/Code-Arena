import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { getRedis } from '../config/redis';
import {
  startContest,
  pauseContest,
  resumeContest,
  endContest,
  extendContest,
  getContestTimes,
  getContestState,
  setAnnouncement,
  getDifficultyCurve,
  setDifficultyCurve,
  getInfraStats,
  createEvent,
  hardReset,
  softReset,
  getCurrentEventId,
  getEventHistory,
  deleteAnnouncement,
  getContestMode,
  setContestMode,
} from '../services/contestState';

// Helper: broadcast contest state change using io attached to req
function broadcastContestState(io: any, state: string, extra?: Record<string, unknown>) {
  io.emit('contest:state', { state, ...extra });
}
import { assignNextProblem, resetUserProgress } from '../services/problemAssigner';
import { getTopN, getAllUsers, adjustLeaderboardScore, registerUserForEvent } from '../services/leaderboard';
import { prisma } from '../config/database';
import { logger } from '../config/logger';
import { getSubmissionQueue } from '../workers/grading';

const router = Router();

// All admin routes require auth + admin role
router.use(authMiddleware, adminOnly);

// ─── Contest Control ─────────────────────────────────────────────────────────

/**
 * POST /admin/start
 * Starts the contest. Assigns first problem to all connected students.
 */
router.post('/start', async (req: Request, res: Response): Promise<void> => {
  try {
    const state = await getContestState();
    if (state !== 'WAITING') {
      res.status(400).json({ error: `Cannot start from state: ${state}` });
      return;
    }

    const durationMinutes = parseInt(process.env.CONTEST_DURATION_MINUTES || '180');
    const endTime = await startContest(durationMinutes);

    // Create an Event record in the DB for this contest run
    const { name: eventName, mode: eventMode } = req.body as { name?: string; mode?: 'INDIVIDUAL' | 'GROUP' };
    const mode = eventMode || 'INDIVIDUAL';
    const eventId = await createEvent(durationMinutes, eventName, mode);

    // Get all registered users and assign their first problems
    const users = await prisma.user.findMany({
      where: { isAdmin: false, isDisqualified: false },
      select: { id: true },
    });

    logger.info(`Assigning first problems to ${users.length} users...`);

    // Register all users in this event's leaderboard + assign problems in batches
    const BATCH = 50;
    for (let i = 0; i < users.length; i += BATCH) {
      const batch = users.slice(i, i + BATCH);
      await Promise.all([
        ...batch.map((u) => assignNextProblem(u.id)),
        ...batch.map((u) => registerUserForEvent(u.id, eventId)),
      ]);
    }

    // Broadcast to all connected clients
    const io = (req as any).io;
    broadcastContestState(io, 'RUNNING', { endTime, remainingMs: durationMinutes * 60 * 1000, eventId, mode });
    io.emit('contest:started', { endTime, eventId, mode });

    await prisma.auditLog.create({
      data: {
        adminId: req.user!.dbUserId,
        action: 'START_CONTEST',
        detail: `Event "${eventId}" started for ${users.length} users (mode: ${mode})`,
      },
    });

    res.json({ success: true, endTime, eventId, usersCount: users.length, mode });
  } catch (err) {
    logger.error('Failed to start contest', { error: err });
    res.status(500).json({ error: 'Failed to start contest' });
  }
});

/**
 * POST /admin/pause
 */
router.post('/pause', async (req: Request, res: Response): Promise<void> => {
  try {
    const state = await getContestState();
    if (state !== 'RUNNING') {
      res.status(400).json({ error: 'Contest is not running' });
      return;
    }

    const { remainingMs } = await pauseContest();
    const io = (req as any).io;
    broadcastContestState(io, 'PAUSED', { remainingMs });

    res.json({ success: true, remainingMs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to pause contest' });
  }
});

/**
 * POST /admin/resume
 */
router.post('/resume', async (req: Request, res: Response): Promise<void> => {
  try {
    const state = await getContestState();
    if (state !== 'PAUSED') {
      res.status(400).json({ error: 'Contest is not paused' });
      return;
    }

    const newEndTime = await resumeContest();
    const io = (req as any).io;
    broadcastContestState(io, 'RUNNING', { endTime: newEndTime });

    res.json({ success: true, newEndTime });
  } catch (err) {
    res.status(500).json({ error: 'Failed to resume contest' });
  }
});

/**
 * POST /admin/stop
 */
router.post('/stop', async (req: Request, res: Response): Promise<void> => {
  try {
    await endContest();
    const io = (req as any).io;
    broadcastContestState(io, 'ENDED');

    await prisma.auditLog.create({
      data: { adminId: req.user!.dbUserId, action: 'STOP_CONTEST' },
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to stop contest' });
  }
});

/**
 * POST /admin/extend
 * Body: { minutes: number }
 */
router.post('/extend', async (req: Request, res: Response): Promise<void> => {
  try {
    const schema = z.object({ minutes: z.number().int().min(1).max(60) });
    const { minutes } = schema.parse(req.body);

    const newEndTime = await extendContest(minutes);
    const io = (req as any).io;
    io.emit('contest:extended', { newEndTime, addedMinutes: minutes });

    await prisma.auditLog.create({
      data: {
        adminId: req.user!.dbUserId,
        action: 'EXTEND_CONTEST',
        detail: `Extended by ${minutes} minutes`,
      },
    });

    res.json({ success: true, newEndTime });
  } catch (err) {
    res.status(500).json({ error: 'Failed to extend contest' });
  }
});

// ─── Announcements ───────────────────────────────────────────────────────────

router.post('/announce', async (req: Request, res: Response): Promise<void> => {
  try {
    const schema = z.object({ message: z.string().min(1).max(500) });
    const { message } = schema.parse(req.body);

    await setAnnouncement(message);
    const io = (req as any).io;
    io.emit('contest:announcement', { message, timestamp: Date.now() });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send announcement' });
  }
});

router.delete('/announce', async (req: Request, res: Response): Promise<void> => {
  try {
    await deleteAnnouncement();
    const io = (req as any).io;
    io.emit('contest:announcement', { message: null, timestamp: Date.now() });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete announcement' });
  }
});

// ─── Manual Overrides ────────────────────────────────────────────────────────

const overrideSchema = z.object({
  targetUserId: z.string(),
  action: z.enum(['ADJUST_AP', 'DISQUALIFY', 'REINSTATE']),
  apDelta: z.number().optional(),
  reason: z.string().min(1).max(500),
});

router.post('/override', async (req: Request, res: Response): Promise<void> => {
  try {
    const { targetUserId, action, apDelta, reason } = overrideSchema.parse(req.body);

    const target = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (action === 'ADJUST_AP' && apDelta !== undefined) {
      const eventId = await getCurrentEventId();
      const newAP = Math.max(0, target.ap + apDelta);
      await prisma.user.update({ where: { id: targetUserId }, data: { ap: newAP } });
      await adjustLeaderboardScore(targetUserId, apDelta, eventId || undefined);

      const io = (req as any).io;
      io.to(`user:${target.uid}`).emit('ap:adjusted', { newAP, reason });
      io.emit('leaderboard:update', { userId: targetUserId, newAP });
    } else if (action === 'DISQUALIFY') {
      await prisma.user.update({ where: { id: targetUserId }, data: { isDisqualified: true } });
      const io = (req as any).io;
      io.to(`user:${target.uid}`).emit('anticheat:locked', { message: `Disqualified: ${reason}` });
    } else if (action === 'REINSTATE') {
      await prisma.user.update({ where: { id: targetUserId }, data: { isDisqualified: false } });
      const redis = getRedis();
      await redis.del(`anticheat:count:${target.uid}`);
      const io = (req as any).io;
      io.to(`user:${target.uid}`).emit('anticheat:unlocked');
    }

    await prisma.auditLog.create({
      data: {
        adminId: req.user!.dbUserId,
        targetUserId,
        action,
        reason,
      },
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to apply override' });
  }
});

// ─── Event Reset Controls ────────────────────────────────────────────────────

const resetSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  durationMinutes: z.number().int().min(1).max(480).optional(),
  mode: z.enum(['INDIVIDUAL', 'GROUP']).optional(),
});

/**
 * POST /admin/reset/soft
 * Restart the timer within the same event — scores and progress are kept.
 * Use this when you want to give students a fresh time window without wiping scores.
 */
router.post('/reset/soft', async (req: Request, res: Response): Promise<void> => {
  try {
    const state = await getContestState();
    if (state !== 'ENDED' && state !== 'PAUSED' && state !== 'RUNNING') {
      res.status(400).json({ error: 'Can only soft-reset from ENDED, RUNNING, or PAUSED state' });
      return;
    }

    const { durationMinutes } = resetSchema.parse(req.body);
    const durationMins = durationMinutes || parseInt(process.env.CONTEST_DURATION_MINUTES || '180');
    const endTime = await softReset(durationMins);
    const eventId = await getCurrentEventId();

    const io = (req as any).io;
    broadcastContestState(io, 'RUNNING', { endTime, remainingMs: durationMins * 60 * 1000, eventId });
    io.emit('contest:started', { endTime, eventId });

    await prisma.auditLog.create({
      data: { adminId: req.user!.dbUserId, action: 'SOFT_RESET', detail: `Timer restarted: ${durationMins} min` },
    });

    res.json({ success: true, endTime, eventId, type: 'soft' });
  } catch (err) {
    logger.error('Soft reset failed', { error: err });
    res.status(500).json({ error: 'Soft reset failed' });
  }
});

/**
 * POST /admin/reset/hard
 * Create a brand new event — all scores and problem progress reset to 0.
 * Body: { name?: string, durationMinutes?: number }
 */
router.post('/reset/hard', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, durationMinutes, mode } = resetSchema.parse(req.body);
    const durationMins = durationMinutes || parseInt(process.env.CONTEST_DURATION_MINUTES || '180');

    const { eventId, endTime } = await hardReset(durationMins, name, mode);

    // Delete all anti-cheat logs from DB
    await prisma.antiCheatEvent.deleteMany({});

    // Reset all user problem progress (clean slate for new event)
    await prisma.user.updateMany({
      where: { isAdmin: false },
      data: {
        currentProblemId: null,
        problemAssignedAt: null,
        problemsAttempted: 0,
        isDisqualified: false,
        ap: 0,
      },
    });

    // Clear anticheat counts and overall AP from Redis
    const redis = getRedis();
    const [anticheatKeys, apKeys] = await Promise.all([
      redis.keys('anticheat:count:*'),
      redis.keys('user:ap:overall:*'),
    ]);
    const keysToDelete = [...anticheatKeys, ...apKeys, 'leaderboard:overall'].filter(Boolean);
    if (keysToDelete.length > 0) {
      await redis.del(keysToDelete);
    }

    // Get all users and assign fresh first problems + register for new event
    const users = await prisma.user.findMany({
      where: { isAdmin: false },
      select: { id: true },
    });

    const BATCH = 50;
    for (let i = 0; i < users.length; i += BATCH) {
      const batch = users.slice(i, i + BATCH);
      await Promise.all([
        ...batch.map((u) => assignNextProblem(u.id)),
        ...batch.map((u) => registerUserForEvent(u.id, eventId)),
      ]);
    }

    const io = (req as any).io;
    broadcastContestState(io, 'RUNNING', { endTime, remainingMs: durationMins * 60 * 1000, eventId });
    io.emit('contest:started', { endTime, eventId });

    await prisma.auditLog.create({
      data: {
        adminId: req.user!.dbUserId,
        action: 'HARD_RESET',
        detail: `New event "${name || eventId}" started. ${users.length} users reset.`,
      },
    });

    res.json({ success: true, endTime, eventId, type: 'hard', usersCount: users.length });
  } catch (err) {
    logger.error('Hard reset failed', { error: err });
    res.status(500).json({ error: 'Hard reset failed' });
  }
});

/**
 * GET /admin/events
 * List all contest events (for history panel).
 */
router.get('/events', async (_req: Request, res: Response): Promise<void> => {
  try {
    const events = await getEventHistory();
    res.json({ events });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// ─── Monitoring ──────────────────────────────────────────────────────────────

router.get('/monitor', async (_req: Request, res: Response): Promise<void> => {
  try {
    const [users, times, infraStats] = await Promise.all([
      getAllUsers(),
      getContestTimes(),
      getInfraStats(),
    ]);

    const queue = getSubmissionQueue();
    const [waiting, active, failed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getFailedCount(),
    ]);

    const dbUsers = await prisma.user.findMany({
      select: { id: true, isDisqualified: true }
    });
    const dqMap = new Map(dbUsers.map(u => [u.id, u.isDisqualified]));

    const usersWithDq = users.map(u => ({
      ...u,
      isDisqualified: dqMap.get(u.userId) || false
    }));

    res.json({
      users: usersWithDq,
      contestState: times.state,
      remainingMs: times.remainingMs,
      queueDepth: waiting + active,
      queueFailed: failed,
      infraStats,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch monitor data' });
  }
});

router.get('/health-detail', async (_req: Request, res: Response): Promise<void> => {
  try {
    const queue = getSubmissionQueue();
    const redis = getRedis();

    const [waiting, active, failed, infraStats, redisInfo] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getFailedCount(),
      getInfraStats(),
      redis.info('memory'),
    ]);

    const memMatch = redisInfo.match(/used_memory_human:(\S+)/);
    const redisMemory = memMatch ? memMatch[1] : 'unknown';

    res.json({
      queue: { waiting, active, failed },
      redis: { memory: redisMemory },
      infra: infraStats,
      process: {
        memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        uptime: Math.round(process.uptime()),
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch health details' });
  }
});

// ─── Difficulty Curve Config ─────────────────────────────────────────────────

router.get('/difficulty-curve', async (_req, res) => {
  const curve = await getDifficultyCurve();
  res.json(curve);
});

router.put('/difficulty-curve', async (req: Request, res: Response): Promise<void> => {
  try {
    const schema = z.object({ easyUpTo: z.number().int().min(1), mediumUpTo: z.number().int().min(1) });
    const curve = schema.parse(req.body);
    await setDifficultyCurve(curve);
    res.json({ success: true, curve });
  } catch (err) {
    res.status(400).json({ error: 'Invalid curve config' });
  }
});

// ─── Export CSV ──────────────────────────────────────────────────────────────

router.get('/export', async (_req: Request, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      where: { isAdmin: false },
      include: {
        solvedProblems: true,
        antiCheatEvents: true,
      },
      orderBy: { ap: 'desc' },
    });

    const rows = [
      'Rank,Name,Email,Roll Number,AP,Problems Solved,Incident Count,Disqualified',
      ...users.map((u, idx) => [
        idx + 1,
        `"${u.name}"`,
        u.email,
        u.rollNumber,
        u.ap.toFixed(2),
        u.solvedProblems.length,
        u.antiCheatEvents.length,
        u.isDisqualified ? 'YES' : 'NO',
      ].join(',')),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="results.csv"');
    res.send(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to export results' });
  }
});

// ─── Contest Mode ────────────────────────────────────────────────────────────

router.get('/mode', async (_req: Request, res: Response): Promise<void> => {
  try {
    const mode = await getContestMode();
    res.json({ mode });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get contest mode' });
  }
});

router.put('/mode', async (req: Request, res: Response): Promise<void> => {
  try {
    const schema = z.object({ mode: z.enum(['INDIVIDUAL', 'GROUP']) });
    const { mode } = schema.parse(req.body);
    await setContestMode(mode);

    const io = (req as any).io;
    io.emit('contest:mode', { mode });

    res.json({ success: true, mode });
  } catch (err) {
    res.status(400).json({ error: 'Invalid mode' });
  }
});

// ─── Team Management (Admin) ─────────────────────────────────────────────────

router.get('/teams', async (_req: Request, res: Response): Promise<void> => {
  try {
    const teams = await prisma.team.findMany({
      include: {
        captain: { select: { id: true, name: true, email: true } },
        members: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ teams });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
});

export default router;
