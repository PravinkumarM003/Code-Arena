import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getTopN, getUserRank, getUserAP, getCombinedTotal, getParticipantCount } from '../services/leaderboard';
import { getContestTimes } from '../services/contestState';
import { prisma } from '../config/database';

const router = Router();

/**
 * GET /leaderboard/top
 * Public endpoint — Top 10 leaderboard (projectable, no login required).
 * Reads entirely from Redis — no TiDB round-trip.
 */
router.get('/top', async (_req: Request, res: Response): Promise<void> => {
  try {
    const [top10, total, count, times] = await Promise.all([
      getTopN(10),
      getCombinedTotal(),
      getParticipantCount(),
      getContestTimes(),
    ]);

    res.json({
      leaderboard: top10,
      combinedTotal: total,
      participantCount: count,
      contestState: times.state,
      remainingMs: times.remainingMs,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

/**
 * GET /leaderboard/me
 * Per-student personal stats. Requires auth.
 */
router.get('/me', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const [ap, rank, total, count] = await Promise.all([
      getUserAP(req.user!.dbUserId),
      getUserRank(req.user!.dbUserId),
      getCombinedTotal(),
      getParticipantCount(),
    ]);

    res.json({ ap, rank, combinedTotal: total, participantCount: count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch personal stats' });
  }
});

/**
 * GET /leaderboard/results
 * Post-contest per-student results page.
 */
router.get('/results', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.dbUserId },
      include: {
        solvedProblems: { include: { problem: { select: { title: true, difficulty: true } } } },
        submissions: {
          where: { status: 'ACCEPTED' },
          select: { apAwarded: true, timeTakenSeconds: true, submittedAt: true, problem: { select: { title: true } } },
          orderBy: { submittedAt: 'asc' },
        },
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const rank = await getUserRank(req.user!.dbUserId);

    res.json({
      name: user.name,
      rollNumber: user.rollNumber,
      ap: user.ap,
      rank,
      problemsSolved: user.solvedProblems.length,
      solvedProblems: user.solvedProblems.map((sp) => ({
        title: sp.problem.title,
        difficulty: sp.problem.difficulty,
        solvedAt: sp.solvedAt,
      })),
      submissions: user.submissions,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

export default router;
