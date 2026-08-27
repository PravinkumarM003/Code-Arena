import { Router, Request, Response } from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { prisma } from '../config/database';
import { logger } from '../config/logger';

const router = Router();

/**
 * GET /results/export
 * Admin-only: post-contest similarity scan + CSV export.
 */
router.get('/plagiarism', authMiddleware, adminOnly, async (_req: Request, res: Response): Promise<void> => {
  try {
    const flags = await prisma.similarityFlag.findMany({
      include: {
        problem: { select: { title: true } },
        user1: { select: { name: true, rollNumber: true } },
        user2: { select: { name: true, rollNumber: true } },
      },
      orderBy: { similarity: 'desc' },
    });

    res.json({ flags });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch plagiarism flags' });
  }
});

/**
 * POST /results/run-similarity
 * Admin-only: Run post-contest similarity scan.
 * Token-based comparison (simple tokenizer). Flags pairs > 0.75 similarity.
 */
router.post('/run-similarity', authMiddleware, adminOnly, async (_req: Request, res: Response): Promise<void> => {
  try {
    const problems = await prisma.problem.findMany({
      where: { isActive: true },
      select: { id: true, title: true },
    });

    let flagCount = 0;

    for (const problem of problems) {
      const submissions = await prisma.submission.findMany({
        where: { problemId: problem.id, status: 'ACCEPTED' },
        select: { userId: true, code: true },
      });

      for (let i = 0; i < submissions.length; i++) {
        for (let j = i + 1; j < submissions.length; j++) {
          if (submissions[i].userId === submissions[j].userId) continue;

          const [user1Id, user2Id] = submissions[i].userId < submissions[j].userId
            ? [submissions[i].userId, submissions[j].userId]
            : [submissions[j].userId, submissions[i].userId];

          const sim = tokenSimilarity(submissions[i].code, submissions[j].code);
          if (sim >= 0.75) {
            await prisma.similarityFlag.upsert({
              where: {
                problemId_userId1_userId2: {
                  problemId: problem.id,
                  userId1: user1Id,
                  userId2: user2Id,
                },
              },
              create: {
                problemId: problem.id,
                userId1: user1Id,
                userId2: user2Id,
                similarity: sim,
              },
              update: { similarity: sim },
            });
            flagCount++;
          }
        }
      }
    }

    logger.info('Similarity scan complete', { flagCount });
    res.json({ success: true, flagCount });
  } catch (err) {
    logger.error('Similarity scan error', { error: err });
    res.status(500).json({ error: 'Similarity scan failed' });
  }
});

/**
 * Simple token-based similarity (Jaccard coefficient on code tokens).
 * Not AST-based but sufficient for flagging obvious copy-paste.
 */
function tokenSimilarity(code1: string, code2: string): number {
  const tokenize = (code: string) => {
    // Strip comments, whitespace, strings, normalize
    const normalized = code
      .replace(/\/\/[^\n]*/g, '')  // C++ / JS line comments
      .replace(/\/\*[\s\S]*?\*\//g, '')  // block comments
      .replace(/#[^\n]*/g, '')  // Python comments
      .replace(/"[^"]*"/g, '""')  // strings
      .replace(/'[^']*'/g, "''")
      .replace(/\s+/g, ' ')
      .trim();

    return new Set(normalized.match(/\b\w+\b/g) || []);
  };

  const tokens1 = tokenize(code1);
  const tokens2 = tokenize(code2);

  // Jaccard similarity
  const intersection = new Set([...tokens1].filter((t) => tokens2.has(t)));
  const union = new Set([...tokens1, ...tokens2]);

  return union.size === 0 ? 0 : intersection.size / union.size;
}

export default router;
