import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  getTopN,
  getTopNOverall,
  getUserRank,
  getUserAP,
  getUserRankOverall,
  getUserAPOverall,
  getCombinedTotal,
  getParticipantCount,
} from '../services/leaderboard';
import { getContestTimes, getCurrentEventId, getEventHistory } from '../services/contestState';
import { prisma } from '../config/database';

const router = Router();

/**
 * GET /leaderboard/top
 * Returns top leaderboard entries.
 * Query params:
 *   ?event=current   → current event leaderboard (default)
 *   ?event=overall   → overall leaderboard (sum across all events)
 *   ?event={id}      → specific past event leaderboard
 *   ?limit=N         → number of results (default 50)
 */
router.get('/top', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string || '50'), 200);
    const eventParam = (req.query.event as string) || 'current';

    let eventId: string | null = null;
    let leaderboardType = 'event';

    if (eventParam === 'overall') {
      leaderboardType = 'overall';
    } else if (eventParam === 'current' || !eventParam) {
      eventId = await getCurrentEventId();
      leaderboardType = 'event';
    } else {
      eventId = eventParam; // specific event ID
      leaderboardType = 'event';
    }

    const [entries, total, count, times] = await Promise.all([
      leaderboardType === 'overall' ? getTopNOverall(limit) : getTopN(limit, eventId),
      getCombinedTotal(leaderboardType === 'overall' ? null : eventId),
      getParticipantCount(leaderboardType === 'overall' ? null : eventId),
      getContestTimes(),
    ]);

    res.json({
      leaderboard: entries,
      combinedTotal: total,
      participantCount: count,
      contestState: times.state,
      remainingMs: times.remainingMs,
      currentEventId: eventId,
      leaderboardType,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

/**
 * GET /leaderboard/events
 * List all events (for the dropdown on the leaderboard page).
 */
router.get('/events', async (_req: Request, res: Response): Promise<void> => {
  try {
    const events = await getEventHistory();
    const currentId = await getCurrentEventId();
    res.json({ events, currentEventId: currentId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

/**
 * GET /leaderboard/me
 * Per-student personal stats. Requires auth.
 * Query: ?event=current|overall|{id}
 */
router.get('/me', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const eventParam = (req.query.event as string) || 'current';
    let eventId: string | null = null;

    if (eventParam === 'overall') {
      const [ap, rank, total, count] = await Promise.all([
        getUserAPOverall(req.user!.dbUserId),
        getUserRankOverall(req.user!.dbUserId),
        getCombinedTotal(null),
        getParticipantCount(null),
      ]);
      res.json({ ap, rank, combinedTotal: total, participantCount: count, leaderboardType: 'overall' });
      return;
    }

    eventId = eventParam === 'current' ? await getCurrentEventId() : eventParam;

    const [ap, rank, total, count] = await Promise.all([
      getUserAP(req.user!.dbUserId, eventId),
      getUserRank(req.user!.dbUserId, eventId),
      getCombinedTotal(eventId),
      getParticipantCount(eventId),
    ]);

    res.json({ ap, rank, combinedTotal: total, participantCount: count, eventId, leaderboardType: 'event' });
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
        eventParticipants: {
          include: { event: { select: { name: true } } },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const [rank, rankOverall] = await Promise.all([
      getUserRank(req.user!.dbUserId, await getCurrentEventId()),
      getUserRankOverall(req.user!.dbUserId),
    ]);

    res.json({
      name: user.name,
      rollNumber: user.rollNumber,
      ap: user.ap,             // overall AP
      rank: rankOverall,       // overall rank
      currentEventRank: rank,
      problemsSolved: user.solvedProblems.length,
      solvedProblems: user.solvedProblems.map((sp) => ({
        title: sp.problem.title,
        difficulty: sp.problem.difficulty,
        solvedAt: sp.solvedAt,
      })),
      submissions: user.submissions,
      events: user.eventParticipants.map((ep) => ({
        eventId: ep.eventId,
        eventName: ep.event.name,
        apEarned: ep.apEarned,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

export default router;
