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
import { logger } from '../config/logger';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// All submission routes require auth
router.use(authMiddleware);

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
  language: z.enum(['PYTHON', 'JAVA', 'CPP', 'JAVASCRIPT']),
  stdin: z.string().max(10_000).default(''), // user-supplied input (multi-line ok)
});

/**
 * POST /submissions/run
 * Executes code with user-provided stdin via Piston. No submission created.
 * Rate-limited: 1 run per 5 seconds per user.
 * Returns stdout, stderr, compile errors, runtime ms.
 */
router.post('/run', async (req: Request, res: Response): Promise<void> => {
  try {
    const redis = getRedis();
    const runLimitKey = `run:cooldown:${req.user!.uid}`;
    const onCooldown = await redis.get(runLimitKey);
    if (onCooldown) {
      res.status(429).json({ error: 'Please wait a moment before running again.' });
      return;
    }

    const { code, language, stdin } = runSchema.parse(req.body);

    // Piston language map
    const LANGUAGE_MAP: Record<string, { language: string; version: string }> = {
      PYTHON: { language: 'python', version: '3.10.0' },
      JAVA: { language: 'java', version: '15.0.2' },
      CPP: { language: 'c++', version: '10.2.0' },
      JAVASCRIPT: { language: 'javascript', version: '18.15.0' },
    };

    const langConfig = LANGUAGE_MAP[language];
    if (!langConfig) {
      res.status(400).json({ error: `Unsupported language: ${language}` });
      return;
    }

    // Set cooldown before executing so spammers are blocked
    await redis.setex(runLimitKey, 5, '1');

    const axios = (await import('axios')).default;
    const pistonUrl = process.env.PISTON_API_URL || 'https://emkc.org/api/v2/piston';
    const startTime = Date.now();

    const response = await axios.post(
      `${pistonUrl}/execute`,
      {
        language: langConfig.language,
        version: langConfig.version,
        files: [{ name: 'main', content: code }],
        stdin,
        run_timeout: 10_000,   // 10s — generous for manual runs
        compile_timeout: 20_000,
        run_memory_limit: 128 * 1024 * 1024,
      },
      { timeout: 30_000 }
    );

    const runtimeMs = Date.now() - startTime;
    const result = response.data;

    // Compile error
    if (result.compile?.code !== 0 && result.compile?.stderr) {
      res.json({
        stdout: '',
        stderr: '',
        compileError: result.compile.stderr,
        runtimeMs,
        exitCode: result.compile.code ?? 1,
      });
      return;
    }

    res.json({
      stdout: result.run?.stdout ?? '',
      stderr: result.run?.stderr ?? '',
      compileError: null,
      runtimeMs,
      exitCode: result.run?.code ?? 0,
    });
  } catch (err: any) {
    logger.error('Run code error', { error: err?.message });
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

