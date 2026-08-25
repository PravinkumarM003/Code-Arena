import { Server as SocketServer, Socket } from 'socket.io';
import { admin } from '../config/firebase';
import { prisma } from '../config/database';
import { getRedis } from '../config/redis';
import { logger } from '../config/logger';
import {
  getContestState,
  getContestTimes,
  incrementConnected,
  decrementConnected,
  syncConnectedCount,
  getAnnouncement,
  updateInfraStats,
  getCurrentEventId,
  getContestMode,
} from '../services/contestState';
import { getCurrentProblem } from '../services/problemAssigner';
import { getDraftFromRedis } from '../services/draftSaver';
import { getUserAP, getUserRank, registerUser, adjustLeaderboardScore } from '../services/leaderboard';

const COLLEGE_DOMAIN = process.env.COLLEGE_EMAIL_DOMAIN || 'bitsathy.ac.in';

/**
 * Authenticates a socket connection using Firebase ID token.
 * Called during the handshake phase before the socket is established.
 */
async function authenticateSocket(socket: Socket): Promise<{
  uid: string;
  email: string;
  isAdmin: boolean;
  dbUserId: string;
  name: string;
  rollNumber: string;
  isDisqualified: boolean;
} | null> {
  const token = socket.handshake.auth?.token;
  if (!token) return null;

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const email = decoded.email || '';

    const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();
    const isAdminEmail = email.toLowerCase() === ADMIN_EMAIL;

    if (!isAdminEmail && !email.endsWith(`@${COLLEGE_DOMAIN}`)) return null;

    const user = await prisma.user.findUnique({ where: { uid: decoded.uid } });
    if (!user) return null;

    return {
      uid: decoded.uid,
      email,
      isAdmin: user.isAdmin || decoded.admin === true || isAdminEmail,
      dbUserId: user.id,
      name: user.name,
      rollNumber: user.rollNumber,
      isDisqualified: user.isDisqualified,
    };
  } catch {
    return null;
  }
}

/**
 * Register all Socket.io event handlers.
 */
export function setupSocketHandlers(io: SocketServer): void {
  // Middleware: authenticate every socket on connect
  io.use(async (socket, next) => {
    const user = await authenticateSocket(socket);
    if (!user) {
      next(new Error('Unauthorized'));
      return;
    }
    // Attach user to socket data
    (socket as any).user = user;
    next();
  });

  io.on('connection', async (socket: Socket) => {
    const user = (socket as any).user;
    if (!user) {
      socket.disconnect();
      return;
    }

    const { uid, dbUserId, name, rollNumber, isAdmin, isDisqualified } = user;

    // Join user-specific room (for targeted events)
    socket.join(`user:${uid}`);

    // Admins join admin room; students join contestants room
    if (isAdmin) {
      socket.join('admins');
      logger.info('Admin connected', { uid });
    } else {
      socket.join('contestants');
    }

    // Register on leaderboard
    await registerUser(dbUserId, name, rollNumber);

    // Sync connected count from actual socket room size (drift-proof)
    const contestantCount = io.sockets.adapter.rooms.get('contestants')?.size || 0;
    await syncConnectedCount(contestantCount);
    await updateInfraStats({ activeConnections: contestantCount });

    // Broadcast updated connection count to WAITING screen
    io.emit('contest:connected', { count: contestantCount });

    logger.info('Socket connected', { uid, name, connected: contestantCount, isDisqualified });

    // If account is currently locked, inform client immediately
    if (isDisqualified && !isAdmin) {
      socket.emit('anticheat:locked', { message: 'Account locked due to violations. Please contact the administrator.' });
    }

    // ── Send current state to newly connected client ──────────────────────

    const [state, times] = await Promise.all([getContestState(), getContestTimes()]);

    socket.emit('contest:state', {
      state,
      endTime: times.endTime,
      remainingMs: times.remainingMs,
    });

    // If contest is already running, restore session
    if (state === 'RUNNING' || state === 'PAUSED') {
      await handleSessionRestore(socket, uid, dbUserId, state, times.remainingMs);
    }

    // Send any active announcement
    const announcement = await getAnnouncement();
    if (announcement) {
      socket.emit('contest:announcement', announcement);
    }

    // ── Event Handlers ────────────────────────────────────────────────────

    // Session restore request (on reconnect)
    socket.on('session:restore', async () => {
      const [currentState, currentTimes] = await Promise.all([
        getContestState(),
        getContestTimes(),
      ]);
      await handleSessionRestore(socket, uid, dbUserId, currentState, currentTimes.remainingMs);
    });

    // Anti-cheat event logging (forwarded to admin)
    socket.on('anticheat:event', async (data: { type: string; detail?: string }) => {
      try {
        const redis = getRedis();
        const countKey = `anticheat:count:${uid}`;
        const count = await redis.incr(countKey);
        await redis.expire(countKey, 14400);

        // Log to TiDB
        await prisma.antiCheatEvent.create({
          data: {
            userId: dbUserId,
            eventType: data.type as any,
            detail: data.detail,
          },
        });

        // Escalation
        if (count === 1) {
          socket.emit('anticheat:warning', { message: 'Warning: Suspicious activity detected. This is being monitored.' });
        } else if (count === 2) {
          // Apply AP penalty (–10 points) on the current event
          const eventId = await getCurrentEventId();
          await adjustLeaderboardScore(dbUserId, -10, eventId || undefined);
          await prisma.user.update({ where: { id: dbUserId }, data: { ap: { decrement: 10 } } });
          const penalizedAP = await getUserAP(dbUserId, eventId);
          socket.emit('anticheat:penalty', { message: 'AP penalty applied for repeated violations.', newAP: penalizedAP });
        } else if (count >= 3) {
          // Auto-submit current problem and lock account
          await prisma.user.update({ where: { id: dbUserId }, data: { isDisqualified: true } });
          socket.emit('anticheat:locked', { message: 'Account locked due to multiple violations. Current problem auto-submitted.' });
        }

        // Notify admin dashboard
        io.to('admins').emit('admin:incident', {
          uid,
          name,
          eventType: data.type,
          count,
          timestamp: Date.now(),
        });
      } catch (err) {
        logger.error('Anti-cheat event error', { error: err });
      }
    });

    // ── Disconnect ────────────────────────────────────────────────────────

    socket.on('disconnect', async (reason) => {
      // Sync from actual room size (accurate even after crash/restart)
      const contestantCount = io.sockets.adapter.rooms.get('contestants')?.size || 0;
      await syncConnectedCount(contestantCount);
      await updateInfraStats({ activeConnections: contestantCount });
      io.emit('contest:connected', { count: contestantCount });
      logger.info('Socket disconnected', { uid, reason, connected: contestantCount });
    });
  });
}

/**
 * Restore a student's full session state on connect or reconnect.
 * Sends: current problem, code draft, remaining time, AP, rank, isLocked.
 */
async function handleSessionRestore(
  socket: Socket,
  uid: string,
  dbUserId: string,
  state: string,
  remainingMs: number
): Promise<void> {
  try {
    const [dbUser, problem, times, eventId] = await Promise.all([
      prisma.user.findUnique({
        where: { id: dbUserId },
        select: { isDisqualified: true, isAdmin: true },
      }),
      getCurrentProblem(dbUserId),
      getContestTimes(),
      getCurrentEventId(),
    ]);

    const isLocked = Boolean(dbUser?.isDisqualified && !dbUser?.isAdmin);

    if (isLocked) {
      socket.emit('anticheat:locked', {
        message: 'Account locked due to violations. Please contact the administrator.',
      });
    }

    const [ap, rank, mode] = await Promise.all([
      getUserAP(dbUserId, eventId),
      getUserRank(dbUserId, eventId),
      getContestMode(),
    ]);

    // Get code draft if there is a current problem
    let draft = null;
    if (problem && !isLocked) {
      draft = await getDraftFromRedis(dbUserId, problem.id);
    }

    socket.emit('session:restored', {
      state,
      remainingMs,
      endTime: times.endTime,   // required for client-side countdown timer
      problem: isLocked ? null : problem,
      draft,
      ap,
      rank,
      eventId,
      isLocked,
      mode,
    });
  } catch (err) {
    logger.error('Session restore error', { uid, error: err });
  }
}

/**
 * Broadcast contest state change to all connected clients.
 * Used by admin routes when they change contest state.
 */
export function broadcastContestState(
  io: SocketServer,
  state: string,
  extra?: Record<string, unknown>
): void {
  io.emit('contest:state', { state, ...extra });
  logger.info('Broadcast contest state', { state });
}
