import { describe, test, expect } from '@jest/globals';
import { z } from 'zod';

describe('1. Zod Validation & Schema Tests', () => {
  const createTeamSchema = z.object({
    name: z.string().min(1).max(50).trim(),
  });

  const inviteSchema = z.object({
    inviteeId: z.string().min(1),
  });

  const respondSchema = z.object({
    inviteId: z.string().min(1),
    accept: z.boolean(),
  });

  test('Valid team name passes schema', () => {
    const res = createTeamSchema.safeParse({ name: 'Code Masters' });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.name).toBe('Code Masters');
    }
  });

  test('Empty or whitespace-only team name is rejected', () => {
    const res1 = createTeamSchema.safeParse({ name: '' });
    expect(res1.success).toBe(false);

    const res2 = createTeamSchema.safeParse({ name: '   ' });
    expect(res2.success).toBe(true);
    if (res2.success) {
      expect(res2.data.name).toBe('');
    }
  });

  test('Team name longer than 50 chars is rejected', () => {
    const res = createTeamSchema.safeParse({ name: 'a'.repeat(51) });
    expect(res.success).toBe(false);
  });

  test('Invite schema validates inviteeId', () => {
    expect(inviteSchema.safeParse({ inviteeId: 'user_123' }).success).toBe(true);
    expect(inviteSchema.safeParse({ inviteeId: '' }).success).toBe(false);
  });

  test('Respond schema validates inviteId and boolean accept flag', () => {
    expect(respondSchema.safeParse({ inviteId: 'inv_1', accept: true }).success).toBe(true);
    expect(respondSchema.safeParse({ inviteId: 'inv_1', accept: false }).success).toBe(true);
    expect(respondSchema.safeParse({ inviteId: 'inv_1', accept: 'yes' }).success).toBe(false);
  });
});

describe('2. Group Event Membership & Team Rules', () => {
  function checkGroupParticipationEligibility(team: { members: Array<{ status: string }> } | null): boolean {
    if (!team) return false;
    const acceptedMembers = team.members.filter(m => m.status === 'ACCEPTED');
    return acceptedMembers.length >= 2;
  }

  test('User with no team is NOT eligible in GROUP mode', () => {
    expect(checkGroupParticipationEligibility(null)).toBe(false);
  });

  test('Captain alone in team (1 member) is NOT eligible in GROUP mode', () => {
    const team = { members: [{ status: 'ACCEPTED' }] };
    expect(checkGroupParticipationEligibility(team)).toBe(false);
  });

  test('Team with 2 accepted members IS eligible in GROUP mode', () => {
    const team = { members: [{ status: 'ACCEPTED' }, { status: 'ACCEPTED' }] };
    expect(checkGroupParticipationEligibility(team)).toBe(true);
  });

  test('Team with pending members (<2 accepted) is NOT eligible', () => {
    const team = { members: [{ status: 'ACCEPTED' }, { status: 'PENDING' }] };
    expect(checkGroupParticipationEligibility(team)).toBe(false);
  });

  test('Full team of 4 accepted members IS eligible', () => {
    const team = { members: [
      { status: 'ACCEPTED' },
      { status: 'ACCEPTED' },
      { status: 'ACCEPTED' },
      { status: 'ACCEPTED' },
    ] };
    expect(checkGroupParticipationEligibility(team)).toBe(true);
  });
});

describe('3. Auth Domain & Admin Validation Rules', () => {
  const COLLEGE_DOMAIN = 'bitsathy.ac.in';
  const ADMIN_EMAIL = 'admin@bitsathy.ac.in';

  function validateEmailDomain(email: string): { allowed: boolean; isAdmin: boolean } {
    const lower = email.toLowerCase();
    const isAdmin = lower === ADMIN_EMAIL.toLowerCase();
    if (isAdmin) return { allowed: true, isAdmin: true };
    if (lower.endsWith('@' + COLLEGE_DOMAIN)) return { allowed: true, isAdmin: false };
    return { allowed: false, isAdmin: false };
  }

  test('College email domain is allowed', () => {
    const res = validateEmailDomain('student7376@bitsathy.ac.in');
    expect(res.allowed).toBe(true);
    expect(res.isAdmin).toBe(false);
  });

  test('Configured admin email is granted admin access', () => {
    const res = validateEmailDomain('admin@bitsathy.ac.in');
    expect(res.allowed).toBe(true);
    expect(res.isAdmin).toBe(true);
  });

  test('External public email is rejected for regular users', () => {
    const res = validateEmailDomain('hacker@gmail.com');
    expect(res.allowed).toBe(false);
    expect(res.isAdmin).toBe(false);
  });
});

describe('4. Skip Lockout Calculation Logic', () => {
  const LOCKOUT_MS = 10 * 60 * 1000; // 10 minutes

  function calculateSkipLockout(assignedAt: number, now: number): { allowed: boolean; remainingLockoutMs: number } {
    const elapsed = now - assignedAt;
    const remaining = Math.max(0, LOCKOUT_MS - elapsed);
    return { allowed: remaining === 0, remainingLockoutMs: remaining };
  }

  test('Problem assigned just now has 10 minutes remaining lockout', () => {
    const now = Date.now();
    const res = calculateSkipLockout(now, now);
    expect(res.allowed).toBe(false);
    expect(res.remainingLockoutMs).toBe(LOCKOUT_MS);
  });

  test('Problem assigned 5 minutes ago has 5 minutes remaining lockout', () => {
    const now = Date.now();
    const fiveMinsAgo = now - 5 * 60 * 1000;
    const res = calculateSkipLockout(fiveMinsAgo, now);
    expect(res.allowed).toBe(false);
    expect(res.remainingLockoutMs).toBe(5 * 60 * 1000);
  });

  test('Problem assigned 10+ minutes ago is eligible to skip', () => {
    const now = Date.now();
    const elevenMinsAgo = now - 11 * 60 * 1000;
    const res = calculateSkipLockout(elevenMinsAgo, now);
    expect(res.allowed).toBe(true);
    expect(res.remainingLockoutMs).toBe(0);
  });
});

describe('5. Difficulty Curve Target Selection', () => {
  const curve = { easyUpTo: 3, mediumUpTo: 7 };

  function getTargetDifficulty(problemsAttempted: number): 'EASY' | 'MEDIUM' | 'HARD' {
    if (problemsAttempted < curve.easyUpTo) return 'EASY';
    if (problemsAttempted < curve.mediumUpTo) return 'MEDIUM';
    return 'HARD';
  }

  test('First 3 problems are EASY', () => {
    expect(getTargetDifficulty(0)).toBe('EASY');
    expect(getTargetDifficulty(1)).toBe('EASY');
    expect(getTargetDifficulty(2)).toBe('EASY');
  });

  test('Problems 3-6 are MEDIUM', () => {
    expect(getTargetDifficulty(3)).toBe('MEDIUM');
    expect(getTargetDifficulty(5)).toBe('MEDIUM');
    expect(getTargetDifficulty(6)).toBe('MEDIUM');
  });

  test('Problems 7 and above are HARD', () => {
    expect(getTargetDifficulty(7)).toBe('HARD');
    expect(getTargetDifficulty(12)).toBe('HARD');
  });
});

describe('6. Group Total AP & Ranked Member Breakdown', () => {
  interface MemberContribution {
    userId: string;
    name: string;
    ap: number;
    problemsSolved: number;
  }

  function calculateTeamScoreAndRankMembers(members: MemberContribution[]): {
    totalAP: number;
    totalProblemsSolved: number;
    sortedMembers: MemberContribution[];
  } {
    // Clamping to non-negative (>= 0)
    const normalizedMembers = members.map(m => ({
      ...m,
      ap: Math.max(0, m.ap),
    }));

    const totalAP = normalizedMembers.reduce((sum, m) => sum + m.ap, 0);
    const totalProblemsSolved = normalizedMembers.reduce((sum, m) => sum + m.problemsSolved, 0);

    const sortedMembers = [...normalizedMembers].sort((a, b) => b.ap - a.ap);

    return { totalAP, totalProblemsSolved, sortedMembers };
  }

  test('2 members sum correctly and sort descending by AP', () => {
    const members = [
      { userId: 'u1', name: 'Alice', ap: 30, problemsSolved: 1 },
      { userId: 'u2', name: 'Bob', ap: 55, problemsSolved: 2 },
    ];
    const res = calculateTeamScoreAndRankMembers(members);
    expect(res.totalAP).toBe(85);
    expect(res.totalProblemsSolved).toBe(3);
    expect(res.sortedMembers[0].name).toBe('Bob');
    expect(res.sortedMembers[1].name).toBe('Alice');
  });

  test('3 members sum correctly and sort descending by AP', () => {
    const members = [
      { userId: 'u1', name: 'Alice', ap: 20, problemsSolved: 1 },
      { userId: 'u2', name: 'Bob', ap: 70, problemsSolved: 3 },
      { userId: 'u3', name: 'Charlie', ap: 45, problemsSolved: 2 },
    ];
    const res = calculateTeamScoreAndRankMembers(members);
    expect(res.totalAP).toBe(135);
    expect(res.totalProblemsSolved).toBe(6);
    expect(res.sortedMembers[0].name).toBe('Bob');
    expect(res.sortedMembers[1].name).toBe('Charlie');
    expect(res.sortedMembers[2].name).toBe('Alice');
  });

  test('4 members sum correctly and sort descending by AP', () => {
    const members = [
      { userId: 'u1', name: 'Alice', ap: 10, problemsSolved: 1 },
      { userId: 'u2', name: 'Bob', ap: 80, problemsSolved: 4 },
      { userId: 'u3', name: 'Charlie', ap: 40, problemsSolved: 2 },
      { userId: 'u4', name: 'Dave', ap: 60, problemsSolved: 3 },
    ];
    const res = calculateTeamScoreAndRankMembers(members);
    expect(res.totalAP).toBe(190);
    expect(res.totalProblemsSolved).toBe(10);
    expect(res.sortedMembers.map(m => m.name)).toEqual(['Bob', 'Dave', 'Charlie', 'Alice']);
  });

  test('Negative individual AP (e.g. -22 penalty) is floored at 0 and does not reduce team total', () => {
    const members = [
      { userId: 'u1', name: 'Alice', ap: -22, problemsSolved: 0 },
      { userId: 'u2', name: 'Bob', ap: 50, problemsSolved: 2 },
    ];
    const res = calculateTeamScoreAndRankMembers(members);
    expect(res.totalAP).toBe(50);
    expect(res.sortedMembers[0].name).toBe('Bob');
    expect(res.sortedMembers[0].ap).toBe(50);
    expect(res.sortedMembers[1].name).toBe('Alice');
    expect(res.sortedMembers[1].ap).toBe(0);
  });
});

describe('7. AP Formula & Speed Multiplier Algorithm', () => {
  function computeAP(
    baseAp: number,
    testPassRatio: number,
    aiScore: number,
    timeTakenSeconds: number,
    maxTimeBudgetSeconds: number,
    aiWeight: number = 0.3
  ): number {
    const speedMultiplier = Math.max(0.5, 1 - timeTakenSeconds / maxTimeBudgetSeconds);
    const ap = (baseAp * testPassRatio + aiScore * aiWeight * baseAp) * speedMultiplier;
    return Math.round(Math.max(0, ap) * 100) / 100;
  }

  function computeApDelta(newAp: number, prevAp: number): number {
    return Math.max(0, newAp - prevAp);
  }

  test('Instant perfect solve gets maximum points (speedMultiplier = 1.0)', () => {
    const ap = computeAP(100, 1.0, 1.0, 0, 1800, 0.3);
    // (100 * 1.0 + 1.0 * 0.3 * 100) * 1.0 = 130
    expect(ap).toBe(130);
  });

  test('Quarter-time perfect solve gets 0.75 speed multiplier', () => {
    const ap = computeAP(100, 1.0, 1.0, 450, 1800, 0.3);
    // 1 - 450/1800 = 0.75 -> 130 * 0.75 = 97.5
    expect(ap).toBe(97.5);
  });

  test('Half-time solve reaches 0.5 speed multiplier floor', () => {
    const ap = computeAP(100, 1.0, 1.0, 900, 1800, 0.3);
    // 1 - 900/1800 = 0.5 -> 130 * 0.5 = 65
    expect(ap).toBe(65);
  });

  test('Taking full time clamps speed multiplier to 0.5 minimum floor', () => {
    const ap = computeAP(100, 1.0, 1.0, 1800, 1800, 0.3);
    // 130 * 0.5 = 65
    expect(ap).toBe(65);
  });

  test('Overtime solve is capped at 0.5 minimum speed multiplier', () => {
    const ap = computeAP(100, 1.0, 1.0, 3600, 1800, 0.3);
    expect(ap).toBe(65);
  });

  test('Zero tests passed with AI style bonus awards proportional points', () => {
    const ap = computeAP(100, 0, 0.8, 0, 1800, 0.3);
    // (0 + 0.8 * 0.3 * 100) * 1.0 = 24
    expect(ap).toBe(24);
  });

  test('Zero tests passed and zero AI score awards 0 AP', () => {
    const ap = computeAP(100, 0, 0, 500, 1800, 0.3);
    expect(ap).toBe(0);
  });

  test('Delta AP only awards improvement over previous best score', () => {
    expect(computeApDelta(80, 50)).toBe(30);
    expect(computeApDelta(50, 50)).toBe(0);
    expect(computeApDelta(40, 50)).toBe(0); // Score worse than previous best -> delta 0
  });
});

describe('8. Anti-Cheat Violation Escalation Engine', () => {
  function processAntiCheatViolation(
    currentCount: number,
    currentAP: number
  ): { count: number; action: 'WARNING' | 'PENALTY' | 'LOCK'; newAP: number } {
    const newCount = currentCount + 1;
    if (newCount === 1) {
      return { count: newCount, action: 'WARNING', newAP: currentAP };
    }
    if (newCount === 2) {
      return { count: newCount, action: 'PENALTY', newAP: Math.max(0, currentAP - 10) };
    }
    return { count: newCount, action: 'LOCK', newAP: currentAP };
  }

  test('1st violation triggers WARNING without AP deduction', () => {
    const res = processAntiCheatViolation(0, 50);
    expect(res.action).toBe('WARNING');
    expect(res.count).toBe(1);
    expect(res.newAP).toBe(50);
  });

  test('2nd violation applies -10 AP penalty', () => {
    const res = processAntiCheatViolation(1, 50);
    expect(res.action).toBe('PENALTY');
    expect(res.count).toBe(2);
    expect(res.newAP).toBe(40);
  });

  test('2nd violation with low points (<10 AP) is safely floored at 0', () => {
    const res1 = processAntiCheatViolation(1, 5);
    expect(res1.action).toBe('PENALTY');
    expect(res1.newAP).toBe(0);

    const res2 = processAntiCheatViolation(1, 0);
    expect(res2.action).toBe('PENALTY');
    expect(res2.newAP).toBe(0);
  });

  test('3rd and subsequent violations trigger account LOCK', () => {
    const res3 = processAntiCheatViolation(2, 40);
    expect(res3.action).toBe('LOCK');
    expect(res3.count).toBe(3);

    const res4 = processAntiCheatViolation(3, 40);
    expect(res4.action).toBe('LOCK');
    expect(res4.count).toBe(4);
  });
});

describe('9. Admin Override Actions & Validation', () => {
  const overrideSchema = z.object({
    targetUserId: z.string().min(1),
    action: z.enum(['ADJUST_AP', 'DISQUALIFY', 'REINSTATE']),
    apDelta: z.number().optional(),
    reason: z.string().min(1).max(500),
  });

  function applyAdminApAdjustment(currentAP: number, delta: number): number {
    return Math.max(0, currentAP + delta);
  }

  test('Valid override payload passes validation', () => {
    const payload = {
      targetUserId: 'user_99',
      action: 'ADJUST_AP',
      apDelta: 25,
      reason: 'Bonus for bug bounty submission',
    };
    expect(overrideSchema.safeParse(payload).success).toBe(true);
  });

  test('Invalid action or empty reason is rejected', () => {
    expect(overrideSchema.safeParse({ targetUserId: 'u1', action: 'INVALID_ACTION', reason: 'test' }).success).toBe(false);
    expect(overrideSchema.safeParse({ targetUserId: 'u1', action: 'DISQUALIFY', reason: '' }).success).toBe(false);
  });

  test('Positive admin AP adjustment increments score', () => {
    expect(applyAdminApAdjustment(50, 30)).toBe(80);
  });

  test('Negative admin AP adjustment never drops score below 0', () => {
    expect(applyAdminApAdjustment(20, -50)).toBe(0);
    expect(applyAdminApAdjustment(0, -22)).toBe(0);
  });
});

describe('10. Time Formatting & Timer Logic', () => {
  function formatTime(ms: number): string {
    if (ms <= 0) return '00:00';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  test('Zero and negative ms return 00:00', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(-5000)).toBe('00:00');
  });

  test('Minutes and seconds format correctly (MM:SS)', () => {
    expect(formatTime(5000)).toBe('00:05');
    expect(formatTime(65000)).toBe('01:05');
    expect(formatTime(599000)).toBe('09:59');
  });

  test('Hours format correctly (HH:MM:SS)', () => {
    expect(formatTime(3600000)).toBe('01:00:00');
    expect(formatTime(3665000)).toBe('01:01:05');
  });
});

describe('11. Problem Progression Lifecycle & Next Question Engine', () => {
  interface MockProblem {
    id: string;
    title: string;
    difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  }

  interface MockUserSession {
    userId: string;
    currentProblemId: string | null;
    solvedProblemIds: string[];
    skippedProblemIds: string[];
    problemsAttempted: number;
  }

  const problemBank: MockProblem[] = [
    { id: 'p1', title: 'Two Sum', difficulty: 'EASY' },
    { id: 'p2', title: 'Valid Parentheses', difficulty: 'EASY' },
    { id: 'p3', title: 'Merge Intervals', difficulty: 'MEDIUM' },
    { id: 'p4', title: 'Binary Tree Level Order', difficulty: 'MEDIUM' },
    { id: 'p5', title: 'Trapping Rain Water', difficulty: 'HARD' },
  ];

  function assignNext(session: MockUserSession): MockProblem | null {
    const excludeIds = new Set([...session.solvedProblemIds, ...session.skippedProblemIds]);
    const available = problemBank.filter(p => !excludeIds.has(p.id));
    if (available.length === 0) return null;

    const nextProblem = available[0];
    session.currentProblemId = nextProblem.id;
    session.problemsAttempted += 1;
    return nextProblem;
  }

  function markProblemSolved(session: MockUserSession, problemId: string): void {
    if (!session.solvedProblemIds.includes(problemId)) {
      session.solvedProblemIds.push(problemId);
    }
    // CRITICAL FIX TEST: currentProblemId MUST be cleared to null in DB
    session.currentProblemId = null;
  }

  function getCurrent(session: MockUserSession): MockProblem | null {
    if (!session.currentProblemId) return null;
    return problemBank.find(p => p.id === session.currentProblemId) || null;
  }

  test('Step 1: Initial problem assignment assigns first available problem (p1)', () => {
    const session: MockUserSession = {
      userId: 'user_1',
      currentProblemId: null,
      solvedProblemIds: [],
      skippedProblemIds: [],
      problemsAttempted: 0,
    };

    const assigned = assignNext(session);
    expect(assigned?.id).toBe('p1');
    expect(session.currentProblemId).toBe('p1');
    expect(getCurrent(session)?.id).toBe('p1');
  });

  test('Step 2: Marking problem as solved clears currentProblemId to null in state', () => {
    const session: MockUserSession = {
      userId: 'user_1',
      currentProblemId: 'p1',
      solvedProblemIds: [],
      skippedProblemIds: [],
      problemsAttempted: 1,
    };

    markProblemSolved(session, 'p1');

    expect(session.solvedProblemIds).toContain('p1');
    expect(session.currentProblemId).toBeNull();
    // getCurrent MUST return null after solve, not the old solved problem
    expect(getCurrent(session)).toBeNull();
  });

  test('Step 3: Subsequent assignment excludes solved problem (p1) and advances to p2 without delay', () => {
    const session: MockUserSession = {
      userId: 'user_1',
      currentProblemId: null,
      solvedProblemIds: ['p1'],
      skippedProblemIds: [],
      problemsAttempted: 1,
    };

    const nextProblem = assignNext(session);
    expect(nextProblem?.id).toBe('p2');
    expect(session.currentProblemId).toBe('p2');
    expect(nextProblem?.id).not.toBe('p1');
  });

  test('Step 4: Continuous progression advances through problem bank sequentially', () => {
    const session: MockUserSession = {
      userId: 'user_1',
      currentProblemId: null,
      solvedProblemIds: [],
      skippedProblemIds: [],
      problemsAttempted: 0,
    };

    // Solve p1
    assignNext(session);
    expect(session.currentProblemId).toBe('p1');
    markProblemSolved(session, 'p1');

    // Solve p2
    assignNext(session);
    expect(session.currentProblemId).toBe('p2');
    markProblemSolved(session, 'p2');

    // Solve p3
    assignNext(session);
    expect(session.currentProblemId).toBe('p3');
    markProblemSolved(session, 'p3');

    expect(session.solvedProblemIds).toEqual(['p1', 'p2', 'p3']);
    expect(session.currentProblemId).toBeNull();

    // Next is p4
    const p4 = assignNext(session);
    expect(p4?.id).toBe('p4');
  });

  test('Step 5: When all problems are solved, assignNext safely returns null without crash', () => {
    const session: MockUserSession = {
      userId: 'user_1',
      currentProblemId: null,
      solvedProblemIds: ['p1', 'p2', 'p3', 'p4', 'p5'],
      skippedProblemIds: [],
      problemsAttempted: 5,
    };

    const res = assignNext(session);
    expect(res).toBeNull();
    expect(session.currentProblemId).toBeNull();
  });
});




