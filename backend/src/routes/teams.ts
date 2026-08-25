import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { prisma } from '../config/database';
import { logger } from '../config/logger';
import { getContestMode } from '../services/contestState';

const router = Router();

// All team routes require auth
router.use(authMiddleware);

// ─── Create Team ──────────────────────────────────────────────────────────────

const createTeamSchema = z.object({
  name: z.string().min(1).max(50).trim(),
});

/**
 * POST /teams/create
 * Create a new team. The creator becomes the captain and first member.
 */
router.post('/create', async (req: Request, res: Response): Promise<void> => {
  try {
    const mode = await getContestMode();
    if (mode !== 'GROUP') {
      res.status(400).json({ error: 'Team formation is only available in GROUP mode' });
      return;
    }

    const { name } = createTeamSchema.parse(req.body);
    const userId = req.user!.dbUserId;

    // Check if user is already in a team
    const existingMembership = await prisma.teamMember.findFirst({
      where: { userId, status: 'ACCEPTED' },
    });
    if (existingMembership) {
      res.status(400).json({ error: 'You are already in a team' });
      return;
    }

    // Check for duplicate team name
    const existingTeam = await prisma.team.findFirst({ where: { name } });
    if (existingTeam) {
      res.status(400).json({ error: 'A team with this name already exists' });
      return;
    }

    // Create team + add captain as first member
    const team = await prisma.team.create({
      data: {
        name,
        captainId: userId,
        members: {
          create: { userId, status: 'ACCEPTED' },
        },
      },
      include: {
        captain: { select: { id: true, name: true, email: true } },
        members: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });

    logger.info('Team created', { teamId: team.id, name, captainId: userId });
    res.json({ success: true, team });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      res.status(400).json({ error: 'Invalid team name' });
      return;
    }
    logger.error('Failed to create team', { error: err });
    res.status(500).json({ error: 'Failed to create team' });
  }
});

// ─── My Team ──────────────────────────────────────────────────────────────────

/**
 * GET /teams/my-team
 * Get the current user's team (if any).
 */
router.get('/my-team', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.dbUserId;

    const membership = await prisma.teamMember.findFirst({
      where: { userId, status: 'ACCEPTED' },
      include: {
        team: {
          include: {
            captain: { select: { id: true, name: true, email: true } },
            members: {
              include: { user: { select: { id: true, name: true, email: true } } },
            },
          },
        },
      },
    });

    if (!membership) {
      res.json({ team: null });
      return;
    }

    res.json({ team: membership.team });
  } catch (err) {
    logger.error('Failed to get team', { error: err });
    res.status(500).json({ error: 'Failed to get team' });
  }
});

// ─── Search Users ─────────────────────────────────────────────────────────────

/**
 * GET /teams/search-users?q=<query>
 * Search users by name or email for inviting.
 */
router.get('/search-users', async (req: Request, res: Response): Promise<void> => {
  try {
    const query = (req.query.q as string || '').trim();
    if (query.length < 2) {
      res.json({ users: [] });
      return;
    }

    const users = await prisma.user.findMany({
      where: {
        isAdmin: false,
        OR: [
          { name: { contains: query } },
          { email: { contains: query } },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        teamMembers: {
          where: { status: 'ACCEPTED' },
          select: { teamId: true },
        },
      },
      take: 20,
    });

    // Map and indicate if user is already in a team
    const results = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      inTeam: u.teamMembers.length > 0,
    }));

    res.json({ users: results });
  } catch (err) {
    logger.error('Failed to search users', { error: err });
    res.status(500).json({ error: 'Failed to search users' });
  }
});

// ─── Invite User ──────────────────────────────────────────────────────────────

const inviteSchema = z.object({
  inviteeId: z.string().min(1),
});

/**
 * POST /teams/invite
 * Invite a user to join the team. Only the captain can invite.
 */
router.post('/invite', async (req: Request, res: Response): Promise<void> => {
  try {
    const { inviteeId } = inviteSchema.parse(req.body);
    const userId = req.user!.dbUserId;

    // Find the user's team where they are captain
    const team = await prisma.team.findFirst({
      where: { captainId: userId },
      include: {
        members: { where: { status: 'ACCEPTED' } },
        _count: { select: { invites: { where: { status: 'PENDING' } } } },
      },
    });

    if (!team) {
      res.status(403).json({ error: 'You are not a captain of any team' });
      return;
    }

    // Check team size limit (default 4)
    if (team.members.length >= 4) {
      res.status(400).json({ error: 'Team is already full (max 4 members)' });
      return;
    }

    // Check if invitee is already in a team
    const inviteeInTeam = await prisma.teamMember.findFirst({
      where: { userId: inviteeId, status: 'ACCEPTED' },
    });
    if (inviteeInTeam) {
      res.status(400).json({ error: 'This user is already in a team' });
      return;
    }

    // Check for existing pending invite
    const existingInvite = await prisma.teamInvite.findUnique({
      where: { teamId_inviteeId: { teamId: team.id, inviteeId } },
    });
    if (existingInvite && existingInvite.status === 'PENDING') {
      res.status(400).json({ error: 'Invite already sent to this user' });
      return;
    }

    // Create or update invite
    const invite = await prisma.teamInvite.upsert({
      where: { teamId_inviteeId: { teamId: team.id, inviteeId } },
      update: { status: 'PENDING', createdAt: new Date() },
      create: {
        teamId: team.id,
        inviterId: userId,
        inviteeId,
        status: 'PENDING',
      },
      include: {
        team: { select: { name: true } },
        inviter: { select: { name: true } },
      },
    });

    // Emit socket event to the invitee
    const io = (req as any).io;
    if (io) {
      // Find the invitee's Firebase UID to emit to their socket room
      const invitee = await prisma.user.findUnique({ where: { id: inviteeId }, select: { uid: true } });
      if (invitee) {
        io.to(`user:${invitee.uid}`).emit('team:invite', {
          inviteId: invite.id,
          teamId: team.id,
          teamName: invite.team.name,
          inviterName: invite.inviter.name,
          timestamp: Date.now(),
        });
      }
    }

    logger.info('Team invite sent', { teamId: team.id, inviteeId });
    res.json({ success: true, invite });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      res.status(400).json({ error: 'Invalid invite data' });
      return;
    }
    logger.error('Failed to send invite', { error: err });
    res.status(500).json({ error: 'Failed to send invite' });
  }
});

// ─── Respond to Invite ────────────────────────────────────────────────────────

const respondSchema = z.object({
  inviteId: z.string().min(1),
  accept: z.boolean(),
});

/**
 * POST /teams/respond
 * Accept or reject a team invite.
 */
router.post('/respond', async (req: Request, res: Response): Promise<void> => {
  try {
    const { inviteId, accept } = respondSchema.parse(req.body);
    const userId = req.user!.dbUserId;

    const invite = await prisma.teamInvite.findUnique({
      where: { id: inviteId },
      include: {
        team: {
          include: {
            captain: { select: { id: true, uid: true, name: true } },
            members: { where: { status: 'ACCEPTED' } },
          },
        },
      },
    });

    if (!invite || invite.inviteeId !== userId) {
      res.status(404).json({ error: 'Invite not found' });
      return;
    }

    if (invite.status !== 'PENDING') {
      res.status(400).json({ error: 'Invite already responded to' });
      return;
    }

    const io = (req as any).io;

    if (accept) {
      // Check if team is still not full
      if (invite.team.members.length >= 4) {
        await prisma.teamInvite.update({ where: { id: inviteId }, data: { status: 'REJECTED' } });
        res.status(400).json({ error: 'Team is already full' });
        return;
      }

      // Check if user is already in another team
      const existingMembership = await prisma.teamMember.findFirst({
        where: { userId, status: 'ACCEPTED' },
      });
      if (existingMembership) {
        await prisma.teamInvite.update({ where: { id: inviteId }, data: { status: 'REJECTED' } });
        res.status(400).json({ error: 'You are already in a team' });
        return;
      }

      // Accept: update invite + add as team member
      await prisma.$transaction([
        prisma.teamInvite.update({ where: { id: inviteId }, data: { status: 'ACCEPTED' } }),
        prisma.teamMember.create({ data: { teamId: invite.teamId, userId, status: 'ACCEPTED' } }),
      ]);

      // Notify captain
      if (io) {
        const acceptedUser = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
        io.to(`user:${invite.team.captain.uid}`).emit('team:accepted', {
          teamId: invite.teamId,
          userId,
          userName: acceptedUser?.name,
          timestamp: Date.now(),
        });

        // Broadcast team update to all team members
        const members = await prisma.teamMember.findMany({
          where: { teamId: invite.teamId, status: 'ACCEPTED' },
          include: { user: { select: { uid: true } } },
        });
        for (const m of members) {
          io.to(`user:${m.user.uid}`).emit('team:update', { teamId: invite.teamId, timestamp: Date.now() });
        }
      }
    } else {
      // Reject
      await prisma.teamInvite.update({ where: { id: inviteId }, data: { status: 'REJECTED' } });

      // Notify captain
      if (io) {
        const rejectedUser = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
        io.to(`user:${invite.team.captain.uid}`).emit('team:rejected', {
          teamId: invite.teamId,
          userId,
          userName: rejectedUser?.name,
          timestamp: Date.now(),
        });
      }
    }

    // Get updated team data
    const updatedTeam = await prisma.team.findUnique({
      where: { id: invite.teamId },
      include: {
        captain: { select: { id: true, name: true, email: true } },
        members: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });

    logger.info('Team invite responded', { inviteId, accept, teamId: invite.teamId });
    res.json({ success: true, accepted: accept, team: updatedTeam });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      res.status(400).json({ error: 'Invalid response data' });
      return;
    }
    logger.error('Failed to respond to invite', { error: err });
    res.status(500).json({ error: 'Failed to respond to invite' });
  }
});

// ─── Get Pending Invites ──────────────────────────────────────────────────────

/**
 * GET /teams/invites
 * Get pending invites for the current user.
 */
router.get('/invites', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.dbUserId;

    const invites = await prisma.teamInvite.findMany({
      where: { inviteeId: userId, status: 'PENDING' },
      include: {
        team: { select: { id: true, name: true } },
        inviter: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ invites });
  } catch (err) {
    logger.error('Failed to get invites', { error: err });
    res.status(500).json({ error: 'Failed to get invites' });
  }
});

// ─── Leave Team ───────────────────────────────────────────────────────────────

/**
 * POST /teams/leave
 * Leave the current team. Captain cannot leave (must disband instead).
 */
router.post('/leave', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.dbUserId;

    const membership = await prisma.teamMember.findFirst({
      where: { userId, status: 'ACCEPTED' },
      include: { team: true },
    });

    if (!membership) {
      res.status(400).json({ error: 'You are not in a team' });
      return;
    }

    if (membership.team.captainId === userId) {
      res.status(400).json({ error: 'Captain cannot leave the team. Disband the team instead.' });
      return;
    }

    await prisma.teamMember.delete({ where: { id: membership.id } });

    // Notify team members
    const io = (req as any).io;
    if (io) {
      const members = await prisma.teamMember.findMany({
        where: { teamId: membership.teamId, status: 'ACCEPTED' },
        include: { user: { select: { uid: true } } },
      });
      for (const m of members) {
        io.to(`user:${m.user.uid}`).emit('team:update', { teamId: membership.teamId, timestamp: Date.now() });
      }
    }

    logger.info('User left team', { userId, teamId: membership.teamId });
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to leave team', { error: err });
    res.status(500).json({ error: 'Failed to leave team' });
  }
});

// ─── Disband Team ─────────────────────────────────────────────────────────────

/**
 * DELETE /teams/:id
 * Disband a team. Only the captain can disband.
 */
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const teamId = req.params.id;
    const userId = req.user!.dbUserId;

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        members: {
          include: { user: { select: { uid: true } } },
        },
      },
    });

    if (!team) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    if (team.captainId !== userId) {
      res.status(403).json({ error: 'Only the captain can disband the team' });
      return;
    }

    // Notify all members before deletion
    const io = (req as any).io;
    if (io) {
      for (const m of team.members) {
        io.to(`user:${m.user.uid}`).emit('team:disbanded', {
          teamId,
          teamName: team.name,
          timestamp: Date.now(),
        });
      }
    }

    // Delete team (cascades to members and invites)
    await prisma.team.delete({ where: { id: teamId } });

    logger.info('Team disbanded', { teamId, captainId: userId });
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to disband team', { error: err });
    res.status(500).json({ error: 'Failed to disband team' });
  }
});

export default router;
