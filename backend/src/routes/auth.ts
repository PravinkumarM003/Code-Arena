import { Router, Request, Response } from 'express';
import { admin } from '../config/firebase';
import { prisma } from '../config/database';
import { logger } from '../config/logger';

const router = Router();

const COLLEGE_DOMAIN = process.env.COLLEGE_EMAIL_DOMAIN || 'bitsathy.ac.in';

/**
 * POST /auth/login
 * Called by the frontend immediately after Google Sign-In.
 * Verifies the Firebase ID token and upserts the user in TiDB.
 * Returns the user record so the frontend knows if they are an admin.
 */
router.post('/login', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  const token = authHeader.slice(7);

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const email = decoded.email || '';

    // Auto-promote configured admin email (must be checked before domain validation)
    const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();
    const isAdminEmail = email.toLowerCase() === ADMIN_EMAIL;

    // Block non-college emails UNLESS it's the designated admin email
    if (!isAdminEmail && !email.endsWith(`@${COLLEGE_DOMAIN}`)) {
      return res.status(403).json({ error: `Only @${COLLEGE_DOMAIN} accounts are allowed.` });
    }

    // Derive display name and roll number from email/token
    const name = decoded.name || email.split('@')[0];
    const rollNumber = email.split('@')[0].toUpperCase();

    // Upsert: create user if first login, update lastSeenAt on subsequent logins
    const user = await prisma.user.upsert({
      where: { uid: decoded.uid },
      update: { lastSeenAt: new Date(), name, ...(isAdminEmail ? { isAdmin: true } : {}) },
      create: {
        uid: decoded.uid,
        email,
        name,
        rollNumber,
        isAdmin: isAdminEmail,
      },
    });

    // Set Firebase custom claim so the frontend token reflects admin status
    if (isAdminEmail && decoded.admin !== true) {
      await admin.auth().setCustomUserClaims(decoded.uid, { admin: true });
      logger.info('Admin custom claim set', { email });
    }

    logger.info('User logged in', { uid: decoded.uid, email, isAdmin: user.isAdmin });

    return res.json({
      id: user.id,
      uid: user.uid,
      email: user.email,
      name: user.name,
      rollNumber: user.rollNumber,
      isAdmin: user.isAdmin,
      ap: user.ap,
    });
  } catch (err) {
    logger.error('Auth login error', { error: err });
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
});

export default router;
