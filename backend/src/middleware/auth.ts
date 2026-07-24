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
    if (!email.endsWith(`@${COLLEGE_DOMAIN}`)) {
      logger.warn('Auth rejected: invalid email domain', { email });
      res.status(403).json({ error: `Only @${COLLEGE_DOMAIN} accounts are allowed` });
      return;
    }

    // 3. Single active session enforcement: check session token in Redis
    const redis = getRedis();
    const storedToken = await redis.get(`session:${decoded.uid}`);
    if (storedToken && storedToken !== idToken.slice(-32)) {
      // Token fingerprint mismatch — another session is active
      // We allow it but flag it (soft enforcement; hard enforcement via disqualification)
      logger.warn('Multiple sessions detected', { uid: decoded.uid });
    }

    // 4. Look up user in DB (upsert on first login)
    let user = await prisma.user.findUnique({ where: { uid: decoded.uid } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          uid: decoded.uid,
          email,
          name: decoded.name || email.split('@')[0],
          isAdmin: decoded.admin === true,
        },
      });
      logger.info('New user registered', { email });
    }

    // 5. Update session token fingerprint in Redis (last 32 chars of token)
    await redis.setex(`session:${decoded.uid}`, 7200, idToken.slice(-32));

    req.user = {
      uid: decoded.uid,
      email,
      isAdmin: user.isAdmin || decoded.admin === true,
      dbUserId: user.id,
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
