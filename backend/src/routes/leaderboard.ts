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
  getTeamLeaderboard,
  getUserTeamLeaderboardEntry,
} from '../services/leaderboard';
import { getContestTimes, getCurrentEventId, getEventHistory, getContestMode } from '../services/contestState';
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

    // Check if this event is in GROUP mode and get name
    let mode = await getContestMode();
    let eventName = null;
    if (eventId) {
      const eventRecord = await prisma.event.findUnique({ where: { id: eventId }, select: { mode: true, name: true } });
      if (eventRecord) {
        mode = eventRecord.mode as any;
        eventName = eventRecord.name;
      }
    }

    // If GROUP mode and not overall, also return team leaderboard
    let teamLeaderboard = null;
    if (mode === 'GROUP' && leaderboardType !== 'overall') {
      teamLeaderboard = await getTeamLeaderboard(eventId, limit);
    }

    const [entries, total, count, times] = await Promise.all([
      leaderboardType === 'overall' ? getTopNOverall(limit) : getTopN(limit, eventId),
      getCombinedTotal(leaderboardType === 'overall' ? null : eventId),
      getParticipantCount(leaderboardType === 'overall' ? null : eventId),
      getContestTimes(),
    ]);

    res.json({
      leaderboard: entries,
      teamLeaderboard,
      combinedTotal: total,
      participantCount: count,
      contestState: times.state,
      remainingMs: times.remainingMs,
      currentEventId: eventId,
      eventName,
      leaderboardType,
      mode,
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
    const eventParam = (req.query.event as string) || 'current';
    const eventId = eventParam === 'current' ? await getCurrentEventId() : eventParam;

    const user = await prisma.user.findUnique({
      where: { id: req.user!.dbUserId },
      include: {
        solvedProblems: { 
          where: eventId ? { eventId } : undefined,
          include: { problem: { select: { title: true, difficulty: true } } } 
        },
        submissions: {
          where: { status: 'ACCEPTED', ...(eventId ? { eventId } : {}) },
          select: { apAwarded: true, timeTakenSeconds: true, submittedAt: true, problem: { select: { title: true } } },
          orderBy: { submittedAt: 'asc' },
        },
        eventParticipants: {
          include: { event: { select: { name: true, mode: true } } },
          orderBy: { joinedAt: 'asc' },
        },
        teamMembers: {
          where: { 
            status: 'ACCEPTED',
            ...(eventId ? { team: { eventId } } : {})
          },
          include: {
            team: {
              include: {
                captain: { select: { name: true } },
                members: {
                  where: { status: 'ACCEPTED' },
                  include: { user: { select: { id: true, name: true } } },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const [rank, rankOverall, mode] = await Promise.all([
      getUserRank(req.user!.dbUserId, eventId),
      getUserRankOverall(req.user!.dbUserId),
      getContestMode(),
    ]);

    let finalAP = Math.max(0, user.ap);
    let finalRank = rankOverall;
    let finalProblemsSolved = user.solvedProblems.length;
    let teamInfo = null;

    if (mode === 'GROUP') {
      const teamEntry = await getUserTeamLeaderboardEntry(req.user!.dbUserId, eventId);
      if (teamEntry) {
        finalAP = teamEntry.totalAP;
        finalRank = teamEntry.rank;
        finalProblemsSolved = teamEntry.totalProblemsSolved;
        teamInfo = {
          teamId: teamEntry.teamId,
          teamName: teamEntry.teamName,
          captainName: teamEntry.captainName,
          totalAP: teamEntry.totalAP,
          rank: teamEntry.rank,
          totalProblemsSolved: teamEntry.totalProblemsSolved,
          members: teamEntry.members, // already sorted descending by AP
        };
      }
    }

    res.json({
      name: user.name,
      rollNumber: user.rollNumber,
      ap: finalAP,             // Total Team AP in GROUP mode, or individual AP in INDIVIDUAL mode
      rank: finalRank,         // Team rank in GROUP mode, or individual rank in INDIVIDUAL mode
      currentEventRank: rank,
      problemsSolved: finalProblemsSolved,
      solvedProblems: user.solvedProblems.map((sp: { problem: { title: string; difficulty: string }; solvedAt: Date }) => ({
        title: sp.problem.title,
        difficulty: sp.problem.difficulty,
        solvedAt: sp.solvedAt,
      })),
      submissions: user.submissions,
      events: user.eventParticipants.map((ep: { eventId: string; event: { name: string }; apEarned: number }) => ({
        eventId: ep.eventId,
        eventName: ep.event.name,
        apEarned: ep.apEarned,
      })),
      mode,
      team: teamInfo,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

export default router;
