import { prisma } from '../config/database';
import { getRedis } from '../config/redis';
import { getDifficultyCurve } from './contestState';
import { logger } from '../config/logger';
import type { Difficulty } from '@prisma/client';

const CURRENT_PROBLEM_KEY = (userId: string) => `user:current_problem:${userId}`;
const PROBLEM_ASSIGNED_AT_KEY = (userId: string) => `user:problem_assigned_at:${userId}`;
const PROBLEM_CACHE_TTL = 3600; // 1 hour cache

interface ProblemForClient {
  id: string;
  title: string;
  statement: string;
  difficulty: Difficulty;
  timeBudget: number;
  starterCode: Record<string, string>;
  testCases: Array<{ id: string; input: string; expectedOutput: string; isHidden: boolean; points: number }>;
  assignedAt: number;
}

/**
 * Assign the next problem to a user based on their progression.
 * Respects difficulty curve, excludes already solved/skipped problems.
 * Caches the assignment in Redis for fast reads.
 */
export async function assignNextProblem(userId: string): Promise<ProblemForClient | null> {
  const redis = getRedis();

  // Get the user's current progress
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      solvedProblems: { select: { problemId: true } },
      skippedProblems: { select: { problemId: true } },
    },
  });

  if (!user) {
    logger.error('assignNextProblem: user not found', { userId });
    return null;
  }

  const excludeIds = [
    ...user.solvedProblems.map((s) => s.problemId),
    ...user.skippedProblems.map((s) => s.problemId),
  ];

  // Determine target difficulty based on problems attempted
  const curve = await getDifficultyCurve();
  const attempted = user.problemsAttempted;
  let targetDifficulty: Difficulty;

  if (attempted < curve.easyUpTo) {
    targetDifficulty = 'EASY';
  } else if (attempted < curve.mediumUpTo) {
    targetDifficulty = 'MEDIUM';
  } else {
    targetDifficulty = 'HARD';
  }

  // Pick a random problem of the target difficulty the user hasn't seen
  const problems = await prisma.problem.findMany({
    where: {
      isActive: true,
      difficulty: targetDifficulty,
      id: excludeIds.length > 0 ? { notIn: excludeIds } : undefined,
    },
    include: {
      testCases: {
        orderBy: { orderIndex: 'asc' },
      },
    },
  });

  if (problems.length === 0) {
    // Fall back to any difficulty if current difficulty exhausted
    const fallback = await prisma.problem.findMany({
      where: {
        isActive: true,
        id: excludeIds.length > 0 ? { notIn: excludeIds } : undefined,
      },
      include: { testCases: { orderBy: { orderIndex: 'asc' } } },
    });

    if (fallback.length === 0) {
      logger.info('No more problems available for user', { userId });
      return null;
    }

    problems.push(...fallback);
  }

  // Random selection for fairness (prevents everyone getting the same problem)
  const problem = problems[Math.floor(Math.random() * problems.length)];
  const now = Date.now();

  // Update user in DB
  await prisma.user.update({
    where: { id: userId },
    data: {
      currentProblemId: problem.id,
      problemAssignedAt: new Date(now),
      problemsAttempted: { increment: 1 },
    },
  });

  // Cache in Redis for fast subsequent reads
  const starterCode = problem.starterCode as Record<string, string>;
  const problemData: ProblemForClient = {
    id: problem.id,
    title: problem.title,
    statement: problem.statement,
    difficulty: problem.difficulty,
    timeBudget: problem.timeBudget,
    starterCode,
    testCases: problem.testCases.map((tc) => ({
      id: tc.id,
      input: tc.input,
      expectedOutput: tc.expectedOutput,
      isHidden: tc.isHidden,
      points: tc.points,
    })),
    assignedAt: now,
  };

  await redis.setex(CURRENT_PROBLEM_KEY(userId), PROBLEM_CACHE_TTL, JSON.stringify(problemData));
  await redis.set(PROBLEM_ASSIGNED_AT_KEY(userId), now.toString());

  logger.info('Problem assigned', { userId, problemId: problem.id, difficulty: targetDifficulty });
  return problemData;
}

/**
 * Get the user's current problem from Redis cache (no DB round-trip).
 * Falls back to DB if cache miss.
 */
export async function getCurrentProblem(userId: string): Promise<ProblemForClient | null> {
  const redis = getRedis();

  // Fast path: Redis cache
  const cached = await redis.get(CURRENT_PROBLEM_KEY(userId));
  if (cached) return JSON.parse(cached);

  // Slow path: DB lookup + cache repopulation
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { currentProblemId: true, problemAssignedAt: true },
  });

  if (!user?.currentProblemId) return null;

  const problem = await prisma.problem.findUnique({
    where: { id: user.currentProblemId },
    include: { testCases: { orderBy: { orderIndex: 'asc' } } },
  });

  if (!problem) return null;

  const starterCode = problem.starterCode as Record<string, string>;
  const problemData: ProblemForClient = {
    id: problem.id,
    title: problem.title,
    statement: problem.statement,
    difficulty: problem.difficulty,
    timeBudget: problem.timeBudget,
    starterCode,
    testCases: problem.testCases.map((tc) => ({
      id: tc.id,
      input: tc.input,
      expectedOutput: tc.expectedOutput,
      isHidden: tc.isHidden,
      points: tc.points,
    })),
    assignedAt: user.problemAssignedAt?.getTime() || Date.now(),
  };

  await redis.setex(CURRENT_PROBLEM_KEY(userId), PROBLEM_CACHE_TTL, JSON.stringify(problemData));
  return problemData;
}

/**
 * Check if skip is allowed (10-minute lockout from assignment).
 */
export async function canSkip(userId: string): Promise<{ allowed: boolean; remainingLockoutMs: number }> {
  const redis = getRedis();
  const assignedAtStr = await redis.get(PROBLEM_ASSIGNED_AT_KEY(userId));

  if (!assignedAtStr) {
    return { allowed: true, remainingLockoutMs: 0 };
  }

  const assignedAt = parseInt(assignedAtStr);
  const lockoutMs = (parseInt(process.env.SKIP_LOCKOUT_MINUTES || '10')) * 60 * 1000;
  const elapsed = Date.now() - assignedAt;
  const remainingLockoutMs = Math.max(0, lockoutMs - elapsed);

  return { allowed: remainingLockoutMs === 0, remainingLockoutMs };
}

/**
 * Mark a problem as skipped for a user and assign the next one.
 */
export async function skipProblem(
  userId: string,
  problemId: string
): Promise<ProblemForClient | null> {
  const redis = getRedis();

  // Record the skip
  await prisma.skippedProblem.upsert({
    where: { userId_problemId: { userId, problemId } },
    create: { userId, problemId },
    update: {},
  });

  // Clear cached problem
  await redis.del(CURRENT_PROBLEM_KEY(userId));
  await redis.del(PROBLEM_ASSIGNED_AT_KEY(userId));

  logger.info('Problem skipped', { userId, problemId });

  // Assign next
  return assignNextProblem(userId);
}

/**
 * Record a solved problem and assign the next one.
 */
export async function markSolved(
  userId: string,
  problemId: string
): Promise<void> {
  await prisma.solvedProblem.upsert({
    where: { userId_problemId: { userId, problemId } },
    create: { userId, problemId },
    update: {},
  });

  const redis = getRedis();
  await redis.del(CURRENT_PROBLEM_KEY(userId));
  await redis.del(PROBLEM_ASSIGNED_AT_KEY(userId));

  logger.info('Problem solved', { userId, problemId });
}

/**
 * Get time elapsed on current problem (in seconds).
 */
export async function getElapsedSeconds(userId: string): Promise<number> {
  const redis = getRedis();
  const assignedAtStr = await redis.get(PROBLEM_ASSIGNED_AT_KEY(userId));
  if (!assignedAtStr) return 0;
  return Math.floor((Date.now() - parseInt(assignedAtStr)) / 1000);
}
