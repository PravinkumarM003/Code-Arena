import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { getRedis } from '../config/redis';
import { prisma } from '../config/database';
import { executeCode } from '../services/pistonRunner';
import { gradeWithAI } from '../services/aiGrader';
import { updateLeaderboardScore, getUserAPByEvent, registerUserForEvent } from '../services/leaderboard';
import { markSolved } from '../services/problemAssigner';
import { logger } from '../config/logger';
import { updateInfraStats, getCurrentEventId } from '../services/contestState';
import type { Language } from '@prisma/client';

// ─── Queue Setup ────────────────────────────────────────────────────────────

let submissionQueue: Queue | null = null;
let queueEvents: QueueEvents | null = null;

export function getSubmissionQueue(): Queue {
  if (!submissionQueue) {
    const redis = getRedis();
    submissionQueue = new Queue('submissions', {
      connection: redis,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }
  return submissionQueue;
}

export function getQueueEvents(): QueueEvents {
  if (!queueEvents) {
    const redis = getRedis();
    queueEvents = new QueueEvents('submissions', { connection: redis });
  }
  return queueEvents;
}

// ─── AP Formula ─────────────────────────────────────────────────────────────

function computeAP(
  baseAp: number,
  testPassRatio: number,
  aiScore: number,
  timeTakenSeconds: number,
  maxTimeBudgetSeconds: number
): number {
  const AI_WEIGHT = parseFloat(process.env.AP_AI_WEIGHT || '0.3');

  // Speed multiplier: [0.5, 1.0] — penalises taking too long
  const speedMultiplier = Math.max(0.5, 1 - timeTakenSeconds / maxTimeBudgetSeconds);

  // AP = (base * pass_ratio) + (ai_score * weight) * base_points
  const ap = (baseAp * testPassRatio + aiScore * AI_WEIGHT * baseAp) * speedMultiplier;

  return Math.round(ap * 100) / 100; // Round to 2 decimal places
}

// ─── Job Payload & Result Types ──────────────────────────────────────────────

export interface SubmissionJobData {
  submissionId: string;
  userId: string;
  dbUserId: string;
  problemId: string;
  eventId: string | null;   // which event this submission belongs to
  code: string;
  language: string;
  problemTitle: string;
  problemStatement: string;
  difficulty: string;
  timeBudget: number; // minutes
  baseAp: number;
  timeTakenSeconds: number;
  testCases: Array<{
    id: string;
    input: string;
    expectedOutput: string;
    isHidden: boolean;
    points: number;
  }>;
}

export interface SubmissionJobResult {
  submissionId: string;
  testResults: Array<{
    testCaseId: string;
    passed: boolean;
    runtimeMs: number;
    actualOutput?: string;
    expectedOutput: string;
    isHidden: boolean;
    errorMessage?: string;
  }>;
  passRatio: number;
  status: string;
  apAwarded: number;
  aiScore?: number;
  aiReasoning?: string;
  aiSuggestions?: string;
  compileError?: string;
}

// ─── Worker ──────────────────────────────────────────────────────────────────

export function startGradingWorker(io: any): Worker {
  const redis = getRedis();
  const pistonStartTimes: number[] = [];

  const worker = new Worker<SubmissionJobData, SubmissionJobResult>(
    'submissions',
    async (job: Job<SubmissionJobData>) => {
      const data = job.data;
      logger.info('Processing submission', { submissionId: data.submissionId, userId: data.userId });

      // Track Piston call timing for infra stats
      const pistonStart = Date.now();

      // Step 1: Run code against test cases via Piston
      await prisma.submission.update({
        where: { id: data.submissionId },
        data: { status: 'JUDGING' },
      });

      // Emit "judging" status to user immediately
      io.to(`user:${data.userId}`).emit('submission:judging', {
        submissionId: data.submissionId,
      });

      const pistonResult = await executeCode(data.code, data.language, data.testCases);
      const pistonMs = Date.now() - pistonStart;

      // Track Piston response time for infra panel
      pistonStartTimes.push(pistonMs);
      if (pistonStartTimes.length > 20) pistonStartTimes.shift();
      const avgPistonMs = Math.round(
        pistonStartTimes.reduce((a, b) => a + b, 0) / pistonStartTimes.length
      );
      await updateInfraStats({ avgPistonMs });

      // Determine submission status
      let status = 'WRONG_ANSWER';
      if (pistonResult.compileError) status = 'RUNTIME_ERROR';
      else if (pistonResult.passRatio === 1) status = 'ACCEPTED';
      else if (pistonResult.passRatio > 0) status = 'PARTIAL';

      // Step 2: Emit partial result immediately (test cases done)
      const partialResult: SubmissionJobResult = {
        submissionId: data.submissionId,
        testResults: pistonResult.testResults,
        passRatio: pistonResult.passRatio,
        status,
        apAwarded: 0, // will be updated after AI
        compileError: pistonResult.compileError,
      };

      io.to(`user:${data.userId}`).emit('submission:testResults', partialResult);

      // Step 3: AI grading (async — don't block test result display)
      let aiScore = 0;
      let aiReasoning = '';
      let aiSuggestions = '';

      try {
        const aiResult = await gradeWithAI(
          data.code,
          data.language,
          data.problemTitle,
          data.problemStatement,
          pistonResult.passRatio
        );
        aiScore = aiResult.score;
        aiReasoning = aiResult.reasoning;
        aiSuggestions = aiResult.suggestions || '';
      } catch (err) {
        logger.error('AI grading error in worker', { error: err });
      }

      // Step 4: Compute AP
      const apAwarded = computeAP(
        data.baseAp,
        pistonResult.passRatio,
        aiScore,
        data.timeTakenSeconds,
        data.timeBudget * 60
      );

      // Step 5: Update submission in TiDB
      await prisma.submission.update({
        where: { id: data.submissionId },
        data: {
          status: status as any,
          testPassRatio: pistonResult.passRatio,
          aiScore,
          apAwarded,
          timeTakenSeconds: data.timeTakenSeconds,
          pistonOutput: pistonResult.testResults as any,
          gradedAt: new Date(),
        },
      });

      const eventId = data.eventId || await getCurrentEventId();

      // If fully solved, mark as solved for problem progression
      if (pistonResult.passRatio === 1) {
        await markSolved(data.dbUserId, data.problemId, eventId);
      }

      // Step 6: Update leaderboard — only add the DELTA above previous AP for this problem in this event
      // This prevents score manipulation via repeated re-submissions of the same problem.
      const prevApKey = `submission:ap:${eventId || 'default'}:${data.dbUserId}:${data.problemId}`;
      // NOTE: Use the outer `redis` variable (declared above at worker init), do NOT redeclare.
      const prevApRaw = await redis.get(prevApKey);
      const prevAp = prevApRaw ? parseFloat(prevApRaw) : 0;
      const apDelta = Math.max(0, apAwarded - prevAp);

      // Get accurate count of solved problems
      const totalSolvedCount = await prisma.solvedProblem.count({
        where: {
          userId: data.dbUserId,
          ...(eventId ? { eventId } : {}),
        },
      });

      if (apDelta > 0) {
        await redis.set(prevApKey, apAwarded.toString());

        // Get current event AP and compute new event total
        const currentEventAP = eventId ? await getUserAPByEvent(data.dbUserId, eventId) : 0;
        const newEventAP = currentEventAP + apDelta;

        // Update both per-event and overall leaderboards
        await updateLeaderboardScore(
          data.dbUserId,
          newEventAP,   // absolute event total
          eventId || 'default',
          apDelta,      // delta to add to overall
          {
            problemsSolved: totalSolvedCount,
            lastSubmitTime: Date.now(),
          }
        );

        // Update AP in TiDB (overall AP = sum across all events)
        const userRecord = await prisma.user.update({
          where: { id: data.dbUserId },
          data: { ap: { increment: apDelta } },
          select: { ap: true },
        });

        // Upsert EventParticipant record to track per-event AP
        if (eventId) {
          await prisma.eventParticipant.upsert({
            where: { eventId_userId: { eventId, userId: data.dbUserId } },
            create: { eventId, userId: data.dbUserId, apEarned: apDelta },
            update: { apEarned: { increment: apDelta } },
          });

          // Register user in event leaderboard if first time
          await registerUserForEvent(data.dbUserId, eventId);
        }
      } else if (pistonResult.passRatio === 1) {
        // Even if apDelta is 0 (already had high AP), ensure solved count in meta is updated
        const currentEventAP = eventId ? await getUserAPByEvent(data.dbUserId, eventId) : 0;
        await updateLeaderboardScore(
          data.dbUserId,
          currentEventAP,
          eventId || 'default',
          0,
          {
            problemsSolved: totalSolvedCount,
            lastSubmitTime: Date.now(),
          }
        );
      }

      // Step 7: Emit final result with AI score
      // Show delta AP (what was actually awarded this submission) to the student
      const finalResult: SubmissionJobResult = {
        ...partialResult,
        apAwarded: apDelta,   // show the delta earned this submission (0 if no improvement)
        aiScore,
        aiReasoning,
        aiSuggestions,
      };

      io.to(`user:${data.userId}`).emit('submission:result', finalResult);

      // Broadcast leaderboard update to all clients (only if AP actually changed)
      if (apDelta > 0) {
        const updatedEventAP = eventId ? await getUserAPByEvent(data.dbUserId, eventId) : apDelta;
        io.emit('leaderboard:update', { userId: data.dbUserId, newAP: updatedEventAP, eventId });
      }

      logger.info('Submission graded', {
        submissionId: data.submissionId,
        passRatio: pistonResult.passRatio,
        apAwarded,
        apDelta,
        aiScore,
      });

      return finalResult;
    },
    {
      connection: redis,
      concurrency: 3, // Respects Piston ~5 req/sec limit with headroom
      limiter: { max: 5, duration: 1000 }, // Hard rate limit: 5 jobs/sec
    }
  );

  worker.on('failed', (job, err) => {
    logger.error('Submission job failed', { jobId: job?.id, error: err.message });
    if (job) {
      io.to(`user:${job.data.userId}`).emit('submission:error', {
        submissionId: job.data.submissionId,
        error: 'Grading service error. Please try again.',
      });
    }
  });

  logger.info('Grading worker started (concurrency=3)');
  return worker;
}
