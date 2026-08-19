import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, adminOnly, requireActiveUser } from '../middleware/auth';
import { prisma } from '../config/database';
import { logger } from '../config/logger';

const router = Router();

// Student routes require auth
// Admin CRUD requires auth + adminOnly

// ─── Get current problem (student) ──────────────────────────────────────────

/**
 * GET /problems/current
 * Returns only the student's currently assigned problem.
 * Never returns the full problem bank.
 */
router.get('/current', authMiddleware, requireActiveUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { getCurrentProblem } = await import('../services/problemAssigner');
    const problem = await getCurrentProblem(req.user!.dbUserId);

    if (!problem) {
      res.json({ problem: null, message: 'No problem assigned yet' });
      return;
    }

    res.json({ problem });
  } catch (err) {
    logger.error('Get current problem error', { error: err });
    res.status(500).json({ error: 'Failed to get current problem' });
  }
});

// ─── Skip problem (student) ──────────────────────────────────────────────────

router.post('/skip', authMiddleware, requireActiveUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const schema = z.object({ problemId: z.string() });
    const { problemId } = schema.parse(req.body);

    const { canSkip, skipProblem } = await import('../services/problemAssigner');
    const { allowed, remainingLockoutMs } = await canSkip(req.user!.dbUserId);

    if (!allowed) {
      res.status(403).json({
        error: 'Skip not available yet',
        remainingLockoutMs,
        remainingLockoutMinutes: Math.ceil(remainingLockoutMs / 60000),
      });
      return;
    }

    const nextProblem = await skipProblem(req.user!.dbUserId, problemId);
    res.json({ success: true, nextProblem });
  } catch (err) {
    logger.error('Skip problem error', { error: err });
    res.status(500).json({ error: 'Failed to skip problem' });
  }
});

// ─── Admin CRUD for problems ─────────────────────────────────────────────────

const problemSchema = z.object({
  title: z.string().min(1).max(200),
  statement: z.string().min(1),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
  timeBudget: z.number().int().min(5).max(120).default(30),
  baseAp: z.number().int().min(1).default(100),
  starterCode: z.record(z.string()).default({}),
  testCases: z.array(
    z.object({
      input: z.string(),
      expectedOutput: z.string(),
      isHidden: z.boolean().default(false),
      points: z.number().default(1),
    })
  ),
  isActive: z.boolean().default(true),
});

// GET /problems (admin only — lists all problems)
router.get('/', authMiddleware, adminOnly, async (_req: Request, res: Response): Promise<void> => {
  try {
    const problems = await prisma.problem.findMany({
      include: { testCases: { orderBy: { orderIndex: 'asc' } } },
      orderBy: [{ difficulty: 'asc' }, { orderIndex: 'asc' }],
    });
    res.json({ problems });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch problems' });
  }
});

// POST /problems (admin only — create problem)
router.post('/', authMiddleware, adminOnly, async (req: Request, res: Response): Promise<void> => {
  try {
    const data = problemSchema.parse(req.body);

    const problem = await prisma.problem.create({
      data: {
        title: data.title,
        statement: data.statement,
        difficulty: data.difficulty,
        timeBudget: data.timeBudget,
        baseAp: data.baseAp,
        starterCode: data.starterCode,
        isActive: data.isActive,
        testCases: {
          create: data.testCases.map((tc, idx) => ({
            input: tc.input,
            expectedOutput: tc.expectedOutput,
            isHidden: tc.isHidden,
            points: tc.points,
            orderIndex: idx,
          })),
        },
      },
      include: { testCases: true },
    });

    logger.info('Problem created', { id: problem.id, title: problem.title });
    res.status(201).json({ problem });
  } catch (err) {
    logger.error('Create problem error', { error: err });
    res.status(500).json({ error: 'Failed to create problem' });
  }
});

// PUT /problems/:id (admin only — update problem)
router.put('/:id', authMiddleware, adminOnly, async (req: Request, res: Response): Promise<void> => {
  try {
    const data = problemSchema.partial().parse(req.body);
    const { id } = req.params;

    const problem = await prisma.problem.update({
      where: { id },
      data: {
        ...(data.title && { title: data.title }),
        ...(data.statement && { statement: data.statement }),
        ...(data.difficulty && { difficulty: data.difficulty }),
        ...(data.timeBudget && { timeBudget: data.timeBudget }),
        ...(data.baseAp !== undefined && { baseAp: data.baseAp }),
        ...(data.starterCode && { starterCode: data.starterCode }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });

    // Replace test cases if provided
    if (data.testCases) {
      await prisma.testCase.deleteMany({ where: { problemId: id } });
      await prisma.testCase.createMany({
        data: data.testCases.map((tc, idx) => ({
          problemId: id,
          input: tc.input,
          expectedOutput: tc.expectedOutput,
          isHidden: tc.isHidden ?? false,
          points: tc.points ?? 1,
          orderIndex: idx,
        })),
      });
    }

    res.json({ success: true, problem });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update problem' });
  }
});

// DELETE /problems/:id (admin only)
router.delete('/:id', authMiddleware, adminOnly, async (req: Request, res: Response): Promise<void> => {
  try {
    await prisma.problem.update({
      where: { id: req.params.id },
      data: { isActive: false }, // Soft delete
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete problem' });
  }
});

export default router;
