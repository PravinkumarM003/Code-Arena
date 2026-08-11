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
  language: z.enum(['PYTHON', 'JAVA', 'CPP', 'C', 'JAVASCRIPT', 'TYPESCRIPT', 'CSHARP', 'GO', 'RUST', 'PHP']),
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
      res.status(429).json({ error: 'Please wait 8 seconds before running again.' });
      return;
    }

    const { code, language, stdin } = runSchema.parse(req.body);

    // Maps our language enum to Piston language/version/filename.
    // The filename MUST include the correct extension — Piston uses it to pick the right compiler.
    // Java filename must match the public class name (Main).
    const LANGUAGE_MAP: Record<string, { language: string; version: string; filename: string }> = {
      PYTHON:     { language: 'python',     version: '3.10.0',  filename: 'main.py'    },
      JAVA:       { language: 'java',       version: '15.0.2',  filename: 'Main.java'  },
      CPP:        { language: 'c++',        version: '10.2.0',  filename: 'main.cpp'   },
      C:          { language: 'c',          version: '10.2.0',  filename: 'main.c'     },
      JAVASCRIPT: { language: 'javascript', version: '18.15.0', filename: 'main.js'    },
      TYPESCRIPT: { language: 'typescript', version: '5.0.3',   filename: 'main.ts'    },
      CSHARP:     { language: 'csharp',     version: '6.12.0',  filename: 'main.cs'    },
      GO:         { language: 'go',         version: '1.16.2',  filename: 'main.go'    },
      RUST:       { language: 'rust',       version: '1.68.2',  filename: 'main.rs'    },
      PHP:        { language: 'php',        version: '8.2.3',   filename: 'main.php'   },
    };

    const langConfig = LANGUAGE_MAP[language];
    if (!langConfig) {
      res.status(400).json({ error: `Unsupported language: ${language}` });
      return;
    }

    // Set cooldown BEFORE executing — blocks re-runs while code is executing
    await redis.setex(runLimitKey, 8, '1');

    const axios = (await import('axios')).default;
    const pistonUrl = process.env.PISTON_API_URL || 'https://emkc.org/api/v2/piston';
    const startTime = Date.now();

    let response;
    try {
      response = await axios.post(
        `${pistonUrl}/execute`,
        {
          language: langConfig.language,
          version: langConfig.version,
          // Filename with correct extension is required — Piston uses it to select the compiler.
          // Java: filename must match the public class name (Main.java).
          files: [{ name: langConfig.filename, content: code }],
          stdin,
          run_timeout: 8_000,
          compile_timeout: 15_000,
          run_memory_limit: 128 * 1024 * 1024,
        },
        { timeout: 25_000 }
      );
    } catch (pistonErr: any) {
      // Release cooldown so user can retry immediately
      await redis.del(runLimitKey);

      const status = pistonErr.response?.status;
      const errMsg = pistonErr.response?.data?.message || pistonErr.message || 'unknown';
      logger.error('Piston run error', { language, status, error: errMsg, code: pistonErr.code });

      if (pistonErr.code === 'ECONNABORTED' || pistonErr.code === 'ETIMEDOUT') {
        res.status(503).json({ error: 'Execution timed out. Simplify your code or try again.' });
      } else if (status === 429) {
        res.status(429).json({ error: 'Execution service is busy. Please wait a few seconds and try again.' });
      } else if (status === 400) {
        res.status(400).json({ error: `Execution error: ${errMsg}` });
      } else {
        res.status(503).json({ error: 'Execution service unavailable. Please try again in a moment.' });
      }
      return;
    }

    const runtimeMs = Date.now() - startTime;
    const result = response.data;

    // Compile error — compiler produced errors before the program ran
    if (result.compile?.code !== 0 && result.compile?.stderr) {
      res.json({
        stdout: '',
        stderr: '',
        compileError: result.compile.stderr,
        runtimeError: null,
        runtimeMs,
        exitCode: result.compile.code ?? 1,
      });
      return;
    }

    const exitCode: number = result.run?.code ?? 0;
    const stdout: string  = result.run?.stdout ?? '';
    const stderr: string  = result.run?.stderr ?? '';

    // Runtime error — program ran but crashed / exited non-zero
    // Treat non-zero exit with stderr as a runtime error (distinct from normal stderr output)
    const runtimeError: string | null =
      exitCode !== 0 && stderr ? stderr : null;

    res.json({
      stdout,
      // Only pass stderr through when it's NOT a crash (e.g. deliberate print to stderr)
      stderr: exitCode === 0 ? stderr : '',
      compileError: null,
      runtimeError,   // populated only on crash / non-zero exit
      runtimeMs,
      exitCode,
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

