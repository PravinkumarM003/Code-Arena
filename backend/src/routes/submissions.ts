import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { prisma } from '../config/database';
import { Prisma } from '@prisma/client';
import { getRedis } from '../config/redis';
import { getSubmissionQueue, getQueueEvents } from '../workers/grading';
import { saveDraftToRedis } from '../services/draftSaver';
import { getContestState, getCurrentEventId } from '../services/contestState';
import { getElapsedSeconds, getCurrentProblem } from '../services/problemAssigner';
import { runCode } from '../services/judge0Runner';
import { logger } from '../config/logger';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// All submission routes require auth and active (unlocked) status
router.use(authMiddleware);
router.use(requireActiveUser);

// ─── Submit Code ─────────────────────────────────────────────────────────────

const submitSchema = z.object({
  problemId: z.string(),
  code: z.string().min(1).max(100_000),
  language: z.enum(['PYTHON', 'JAVA', 'CPP', 'JAVASCRIPT']),
});

/**
 * POST /submissions/submit
 * Validates, enqueues the submission, returns job ID immediately.
 * Client polls for result via Socket.io events.
 */
router.post('/submit', async (req: Request, res: Response): Promise<void> => {
  try {
    // Rate limit: 1 active submission per user at a time
    const redis = getRedis();
    const rateLimitKey = `submit:active:${req.user!.uid}`;
    const alreadyActive = await redis.get(rateLimitKey);
    if (alreadyActive) {
      res.status(429).json({ error: 'Please wait for your current submission to finish grading.' });
      return;
    }

    // Check contest is running
    const contestState = await getContestState();
    if (contestState !== 'RUNNING') {
      res.status(403).json({ error: `Contest is ${contestState}. Submissions not accepted.` });
      return;
    }

    const { problemId, code, language } = submitSchema.parse(req.body);

    // Verify this is the user's current assigned problem
    const currentProblem = await getCurrentProblem(req.user!.dbUserId);
    if (!currentProblem || currentProblem.id !== problemId) {
      res.status(400).json({ error: 'This is not your currently assigned problem.' });
      return;
    }

    // Get problem with test cases from DB (for grading)
    const problem = await prisma.problem.findUnique({
      where: { id: problemId },
      include: { testCases: { orderBy: { orderIndex: 'asc' } } },
    });

    if (!problem) {
      res.status(404).json({ error: 'Problem not found.' });
      return;
    }

    const timeTakenSeconds = await getElapsedSeconds(req.user!.dbUserId);
    const submissionId = uuidv4();

    // Create submission record in TiDB (linked to current event)
    const eventId = await getCurrentEventId();

    // Explicitly typed as SubmissionUncheckedCreateInput so TypeScript resolves
    // eventId directly — avoids the Without<> union ambiguity in the IDE.
    const submissionData: Prisma.SubmissionUncheckedCreateInput = {
      id: submissionId,
      userId: req.user!.dbUserId,
      problemId,
      eventId: eventId ?? null,
      code,
      language,
      status: 'PENDING',
      timeTakenSeconds,
      jobId: null,
    };
    await prisma.submission.create({ data: submissionData });

    // Set active submission lock (expires in 60s to prevent stuck locks)
    await redis.setex(rateLimitKey, 60, '1');

    // Enqueue grading job
    const queue = getSubmissionQueue();
    const job = await queue.add('grade', {
      submissionId,
      userId: req.user!.uid,
      dbUserId: req.user!.dbUserId,
      problemId,
      eventId: eventId || null,
      code,
      language,
      problemTitle: problem.title,
      problemStatement: problem.statement,
      difficulty: problem.difficulty,
      timeBudget: problem.timeBudget,
      baseAp: problem.baseAp,
      timeTakenSeconds,
      testCases: problem.testCases.map((tc) => ({
        id: tc.id,
        input: tc.input,
        expectedOutput: tc.expectedOutput,
        isHidden: tc.isHidden,
        points: tc.points,
      })),
    });

    // Update submission with job ID
    await prisma.submission.update({
      where: { id: submissionId },
      data: { jobId: job.id?.toString() },
    });

    // Release rate limit lock when job finishes
    job.waitUntilFinished(getQueueEvents())
      .finally(() => redis.del(rateLimitKey))
      .catch(() => {});

    logger.info('Submission enqueued', {
      submissionId,
      userId: req.user!.uid,
      language,
      jobId: job.id,
    });

    res.status(202).json({
      success: true,
      submissionId,
      jobId: job.id,
      message: 'Your code is being graded. Results will appear shortly.',
    });
  } catch (err) {
    logger.error('Submit error', { error: err });
    res.status(500).json({ error: 'Failed to submit code' });
  }
});

// ─── Save Draft ───────────────────────────────────────────────────────────────

const draftSchema = z.object({
  problemId: z.string(),
  code: z.string().max(100_000),
  language: z.string(),
});

/**
 * POST /submissions/draft
 * Saves code draft to Redis (fast). Called every 7s from client auto-save.
 */
router.post('/draft', async (req: Request, res: Response): Promise<void> => {
  try {
    const { problemId, code, language } = draftSchema.parse(req.body);
    await saveDraftToRedis(req.user!.dbUserId, problemId, code, language);
    res.json({ success: true });
  } catch (err) {
    // Silent fail — draft save should never interrupt the student
    res.json({ success: false });
  }
});

// ─── Run Code (live terminal) ─────────────────────────────────────────────────

const runSchema = z.object({
  code: z.string().min(1).max(100_000),
  language: z.enum(['PYTHON', 'JAVA', 'CPP', 'C', 'JAVASCRIPT', 'TYPESCRIPT', 'CSHARP', 'GO', 'RUST', 'PHP']),
  stdin: z.string().max(10_000).default(''), // user-supplied input (multi-line ok)
});

/**
 * POST /submissions/run
 * Executes code with user-provided stdin via Judge0 CE (free, no API key).
 * Rate-limited: 1 run per 8 seconds per user.
 * Returns stdout, stderr, compileError, runtimeError, runtimeMs, exitCode.
 */
router.post('/run', async (req: Request, res: Response): Promise<void> => {
  try {
    const redis = getRedis();
    const runLimitKey = `run:cooldown:${req.user!.uid}`;
    const onCooldown = await redis.get(runLimitKey);
    if (onCooldown) {
      res.status(429).json({ error: 'Please wait 8 seconds before running again.' });
      return;
    }

    const { code, language, stdin } = runSchema.parse(req.body);

    // Set cooldown BEFORE executing — prevents spam while code is running
    await redis.setex(runLimitKey, 8, '1');

    try {
      const result = await runCode(code, language, stdin);
      res.json(result);
    } catch (execErr: any) {
      // Release cooldown so user can retry immediately on service error
      await redis.del(runLimitKey);
      logger.error('Judge0 run error', { language, error: execErr?.message });

      if (execErr?.message?.includes('timed out')) {
        res.status(503).json({ error: 'Execution timed out. Simplify your code or try again.' });
      } else {
        res.status(503).json({ error: 'Execution service error. Please try again in a moment.' });
      }
    }
  } catch (err: any) {
    logger.error('Run route error', { error: err?.message });
    res.status(500).json({ error: 'Code execution failed. Please try again.' });
  }
});

// ─── Get Submission History (student's own) ──────────────────────────────────

router.get('/history', async (req: Request, res: Response): Promise<void> => {
  try {
    const submissions = await prisma.submission.findMany({
      where: { userId: req.user!.dbUserId },
      select: {
        id: true,
        problemId: true,
        language: true,
        status: true,
        testPassRatio: true,
        aiScore: true,
        apAwarded: true,
        submittedAt: true,
        problem: { select: { title: true, difficulty: true } },
      },
      orderBy: { submittedAt: 'desc' },
      take: 50,
    });

    res.json({ submissions });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch submission history' });
  }
});

export default router;

