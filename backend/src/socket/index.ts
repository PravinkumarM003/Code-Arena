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
  getConnectedCount,
  getAnnouncement,
  updateInfraStats,
} from '../services/contestState';
import { getCurrentProblem } from '../services/problemAssigner';
import { getDraftFromRedis } from '../services/draftSaver';
import { getUserAP, getUserRank, registerUser, updateLeaderboardScore } from '../services/leaderboard';

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
} | null> {
  const token = socket.handshake.auth?.token;
  if (!token) return null;

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const email = decoded.email || '';

    if (!email.endsWith(`@${COLLEGE_DOMAIN}`)) return null;

    const user = await prisma.user.findUnique({ where: { uid: decoded.uid } });
    if (!user) return null;

    return {
      uid: decoded.uid,
      email,
      isAdmin: user.isAdmin || decoded.admin === true,
      dbUserId: user.id,
      name: user.name,
      rollNumber: user.rollNumber,
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

    const { uid, dbUserId, name, rollNumber, isAdmin } = user;

    // Join user-specific room (for targeted events)
    socket.join(`user:${uid}`);

    // Join admin room
    if (isAdmin) {
      socket.join('admins');
      logger.info('Admin connected', { uid });
    }

    // Register on leaderboard
    await registerUser(dbUserId, name, rollNumber);

    // Update connection counter
    const connected = await incrementConnected();
    await updateInfraStats({ activeConnections: connected });

    // Broadcast updated connection count to WAITING screen
    io.emit('contest:connected', { count: connected });

    logger.info('Socket connected', { uid, name, connected });

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
          // Apply AP penalty (–10 points)
          const currentAP = await getUserAP(dbUserId);
          const newAP = Math.max(0, currentAP - 10);
          await updateLeaderboardScore(dbUserId, newAP);
          await prisma.user.update({ where: { id: dbUserId }, data: { ap: newAP } });
          socket.emit('anticheat:penalty', { message: 'AP penalty applied for repeated violations.', newAP });
        } else if (count >= 3) {
          // Auto-submit current problem and lock account
          socket.emit('anticheat:locked', { message: 'Account locked due to multiple violations. Current problem auto-submitted.' });
          await prisma.user.update({ where: { id: dbUserId }, data: { isDisqualified: true } });
          socket.disconnect();
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
      const count = await decrementConnected();
      await updateInfraStats({ activeConnections: count });
      io.emit('contest:connected', { count });
      logger.info('Socket disconnected', { uid, reason, connected: count });
    });
  });
}

/**
 * Restore a student's full session state on connect or reconnect.
 * Sends: current problem, code draft, remaining time, AP, rank.
 */
async function handleSessionRestore(
  socket: Socket,
  uid: string,
  dbUserId: string,
  state: string,
  remainingMs: number
): Promise<void> {
  try {
    const [problem, ap, rank] = await Promise.all([
      getCurrentProblem(dbUserId),
      getUserAP(dbUserId),
      getUserRank(dbUserId),
    ]);

    // Get code draft if there is a current problem
    let draft = null;
    if (problem) {
      draft = await getDraftFromRedis(dbUserId, problem.id);
    }

    socket.emit('session:restored', {
      state,
      remainingMs,
      problem,
      draft,
      ap,
      rank,
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
