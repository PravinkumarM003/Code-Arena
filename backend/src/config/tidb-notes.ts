/**
 * @fileoverview Prisma draft submission upsert workaround.
 * TiDB Serverless doesn't support `ON DUPLICATE KEY UPDATE` via Prisma upsert
 * for non-unique fields elegantly, so we use a compound approach.
 *
 * This file documents the known TiDB-specific limitations and their workarounds
 * used in this project.
 *
 * 1. Prisma `upsert` requires a unique field for `where` clause.
 *    For draft submissions we use a deterministic ID: `draft:{userId}:{problemId}`.
 *
 * 2. TiDB Serverless connection string must include SSL params.
 *    Example: mysql://user:pass@host:4000/db?ssl={"rejectUnauthorized":true}
 *
 * 3. TiDB does not support all MySQL stored procedures.
 *    Avoid using Prisma's `executeRaw` with stored procedures.
 *
 * 4. TiDB Serverless has Request Unit (RU) budgets.
 *    Hot-path data (leaderboard, session state, drafts) must live in Redis.
 *    Only flush to TiDB periodically or on important events.
 */

export {};
