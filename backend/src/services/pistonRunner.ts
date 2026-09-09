/**
 * pistonRunner.ts — DEPRECATED
 *
 * The public Piston API (emkc.org) was shut down in February 2026.
 * All execution is now handled by judge0Runner.ts (Judge0 CE, free, no key needed).
 * This file re-exports from judge0Runner so existing imports in grading.ts
 * continue to work without modification.
 */
export { executeCode, TestCaseResult, GradeResult as PistonExecuteResult } from './judge0Runner';

export async function runWithPiston(code: string, language: string, stdin: string) {
  throw new Error('Piston runner not implemented. Use judge0Runner instead.');
}
