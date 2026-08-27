import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { Server as SocketServer } from 'socket.io';

import { logger } from './config/logger';
import { initFirebase } from './config/firebase';
import { connectDatabase, disconnectDatabase } from './config/database';
import { getRedis, closeRedis } from './config/redis';
import { setupSocketHandlers } from './socket';
import { startGradingWorker } from './workers/grading';
import { startDraftFlusher, flushDirtyDrafts } from './services/draftSaver';
import { getContestTimes, endContest } from './services/contestState';

import adminRouter from './routes/admin';
import authRouter from './routes/auth';
import problemsRouter from './routes/problems';
import submissionsRouter from './routes/submissions';
import leaderboardRouter from './routes/leaderboard';
import resultsRouter from './routes/results';
import teamsRouter from './routes/teams';

// ─── Initialize External Services ───────────────────────────────────────────

initFirebase();

// ─── Express App ─────────────────────────────────────────────────────────────

const app = express();

// Security headers — allow OAuth/Firebase Auth popups without COOP blocking window.closed
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  })
);

// CORS — allow local dev + production URLs
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const ALLOWED_ORIGINS = [
  'http://localhost:5173',                    // local Vite dev server
  'http://localhost:4173',                    // local Vite preview
  'https://bitcodearena.vercel.app',          // production frontend
  'https://code-arena-rqa2.onrender.com',    // Render backend (self + preview)
  FRONTEND_URL,                               // any extra URL from .env
  /\.vercel\.app$/,                           // any Vercel preview deployment
];
app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use(morgan('combined', { stream: { write: (msg) => logger.http(msg.trim()) } }));

// ─── Health endpoint (for UptimeRobot keep-warm pings) ──────────────────────

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

// ─── HTTP Server + Socket.io ─────────────────────────────────────────────────

const server = http.createServer(app);

const io = new SocketServer(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    credentials: true,
  },
  pingTimeout: 30000,
  pingInterval: 10000,
  transports: ['websocket', 'polling'], // WebSocket preferred, polling as fallback
});

// Attach io to every request so routes can broadcast
app.use((req, _res, next) => {
  (req as any).io = io;
  next();
});

// Register Socket.io handlers
setupSocketHandlers(io);

// ─── Routes ──────────────────────────────────────────────────────────────────

app.use('/auth', authRouter);
app.use('/admin', adminRouter);
app.use('/problems', problemsRouter);
app.use('/submissions', submissionsRouter);
app.use('/leaderboard', leaderboardRouter);
app.use('/results', resultsRouter);
app.use('/teams', teamsRouter);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Contest Timer (server-side auto-end) ────────────────────────────────────

async function startContestTimerWatcher() {
  // Check every 30 seconds if the contest timer has expired
  setInterval(async () => {
    try {
      const { state, remainingMs } = await getContestTimes();
      if (state === 'RUNNING' && remainingMs <= 0) {
        logger.info('Contest timer expired — auto-ending contest');
        await endContest();
        io.emit('contest:state', { state: 'ENDED' });
      }
    } catch (err) {
      logger.error('Timer watcher error', { error: err });
    }
  }, 30_000);
}

// ─── Startup ──────────────────────────────────────────────────────────────────

async function start() {
  try {
    // Connect to database
    await connectDatabase();

    // Verify Redis connection
    const redis = getRedis();
    await redis.ping();
    logger.info('Redis connection verified');

    // Start grading worker
    startGradingWorker(io);

    // Start draft flush timer
    startDraftFlusher();

    // Start contest timer watcher
    await startContestTimerWatcher();

    // Start HTTP server
    const PORT = parseInt(process.env.PORT || '4000');
    server.listen(PORT, () => {
      logger.info(`🚀 Contest Platform server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV}`);
      logger.info(`Frontend URL: ${FRONTEND_URL}`);
    });
  } catch (err: any) {
    logger.error('Failed to start server', {
      error: err?.message || String(err),
      stack: err?.stack,
    });
    process.exit(1);
  }
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string) {
  logger.info(`${signal} received — shutting down gracefully`);

  try {
    // Flush any pending drafts before shutdown
    await flushDirtyDrafts();

    server.close(async () => {
      await disconnectDatabase();
      await closeRedis();
      logger.info('Server shut down cleanly');
      process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => process.exit(1), 10_000);
  } catch (err) {
    logger.error('Shutdown error', { error: err });
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
