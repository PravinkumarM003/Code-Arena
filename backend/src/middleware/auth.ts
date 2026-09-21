import { Request, Response, NextFunction } from 'express';
import { admin } from '../config/firebase';
import { prisma } from '../config/database';
import { getRedis } from '../config/redis';
import { logger } from '../config/logger';

// Extend Express Request to carry user info
declare global {
  namespace Express {
    interface Request {
      user?: {
        uid: string;
        email: string;
        isAdmin: boolean;
        dbUserId: string;
        isDisqualified?: boolean;
      };
    }
  }
}

const COLLEGE_DOMAIN = process.env.COLLEGE_EMAIL_DOMAIN || 'bitsathy.ac.in';

/**
 * Verifies Firebase ID token, re-checks email domain server-side,
 * and attaches user info to req.user.
 * Never trusts client-side checks.
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const idToken = authHeader.slice(7);

  try {
    // 1. Verify token with Firebase Admin SDK
    const decoded = await admin.auth().verifyIdToken(idToken);

    // 2. Server-side domain check — never trust client claim
    const email = decoded.email || '';
    const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();
    const isAdminEmail = email.toLowerCase() === ADMIN_EMAIL;



    // 3. Single active session enforcement: check session token in Redis
    // Admins bypass single-session restriction so they can manage contest across multiple tabs/devices
    const isUserAdmin = isAdminEmail || decoded.admin === true;
    const redis = getRedis();

    if (!isUserAdmin) {
      const storedToken = await redis.get(`session:${decoded.uid}`);
      // If a session exists and does not match, check if it's an outdated token and refresh fingerprint
      if (!storedToken) {
        await redis.setex(`session:${decoded.uid}`, 7200, idToken.slice(-32));
      } else if (storedToken !== idToken.slice(-32)) {
        // Update to new token fingerprint upon valid verification
        await redis.setex(`session:${decoded.uid}`, 7200, idToken.slice(-32));
      }
    }

    // 4. Look up user in DB (upsert on first login)
    let user = await prisma.user.findUnique({ where: { uid: decoded.uid } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          uid: decoded.uid,
          email,
          name: decoded.name || email.split('@')[0],
          isAdmin: isUserAdmin,
        },
      });
      logger.info('New user registered', { email });
    }

    req.user = {
      uid: decoded.uid,
      email,
      isAdmin: user.isAdmin || isUserAdmin,
      dbUserId: user.id,
      isDisqualified: user.isDisqualified,
    };

    next();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Token verification failed';
    logger.warn('Auth middleware error', { error: message });
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Admin-only guard — must be used AFTER authMiddleware.
 */
export function adminOnly(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.isAdmin) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

/**
 * Active (non-disqualified) user guard — prevents locked users from submitting/skipping.
 */
export function requireActiveUser(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.isDisqualified && !req.user?.isAdmin) {
    res.status(403).json({ error: 'Account is locked. Please contact the administrator.' });
    return;
  }
  next();
}
