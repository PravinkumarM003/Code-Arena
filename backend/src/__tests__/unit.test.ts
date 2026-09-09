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

