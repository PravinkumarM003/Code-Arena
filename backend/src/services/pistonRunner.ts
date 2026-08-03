import axios from 'axios';
import { logger } from '../config/logger';

const PISTON_URL = process.env.PISTON_API_URL || 'https://emkc.org/api/v2/piston';

// Maps our language enum to Piston language identifiers
// Using '*' for version selects the latest available runtime — safer than pinning exact versions
// which may not be available on the public Piston API (emkc.org/api/v2/piston)
const LANGUAGE_MAP: Record<string, { language: string; version: string }> = {
  PYTHON: { language: 'python', version: '3.10.0' },
  JAVA: { language: 'java', version: '15.0.2' },
  CPP: { language: 'c++', version: '10.2.0' },
  JAVASCRIPT: { language: 'javascript', version: '18.15.0' },
};

export interface TestCaseResult {
  testCaseId: string;
  passed: boolean;
  runtimeMs: number;
  actualOutput?: string;
  expectedOutput: string;
  isHidden: boolean;
  errorMessage?: string;
}

export interface PistonExecuteResult {
  testResults: TestCaseResult[];
  passRatio: number;
  totalRuntimeMs: number;
  compileError?: string;
}

/**
 * Execute code against all test cases using the Piston API.
 * Runs test cases sequentially (respects ~5 req/sec rate limit via BullMQ concurrency).
 */
export async function executeCode(
  code: string,
  language: string,
  testCases: Array<{ id: string; input: string; expectedOutput: string; isHidden: boolean; points: number }>
): Promise<PistonExecuteResult> {
  const langConfig = LANGUAGE_MAP[language.toUpperCase()];
  if (!langConfig) {
    throw new Error(`Unsupported language: ${language}`);
  }

  const testResults: TestCaseResult[] = [];
  let totalRuntimeMs = 0;

  for (const tc of testCases) {
    try {
      const startTime = Date.now();
      const response = await axios.post(
        `${PISTON_URL}/execute`,
        {
          language: langConfig.language,
          version: langConfig.version,
          files: [{ name: 'main', content: code }],
          stdin: tc.input,
          run_timeout: 5000, // 5 second per test case
          compile_timeout: 15000,
          run_memory_limit: 128 * 1024 * 1024, // 128MB
        },
        { timeout: 20000 }
      );

      const runtimeMs = Date.now() - startTime;
      totalRuntimeMs += runtimeMs;

      const result = response.data;

      // Check for compile errors (only relevant on first test case)
      if (result.compile?.code !== 0 && result.compile?.stderr) {
        return {
          testResults: [
            {
              testCaseId: tc.id,
              passed: false,
              runtimeMs,
              expectedOutput: tc.expectedOutput,
              isHidden: tc.isHidden,
              errorMessage: result.compile.stderr,
            },
          ],
          passRatio: 0,
          totalRuntimeMs,
          compileError: result.compile.stderr,
        };
      }

      const actualOutput = (result.run?.stdout || '').trim();
      const expectedOutput = tc.expectedOutput.trim();
      const passed = actualOutput === expectedOutput;

      if (result.run?.code !== 0 && result.run?.stderr) {
        testResults.push({
          testCaseId: tc.id,
          passed: false,
          runtimeMs,
          actualOutput: tc.isHidden ? undefined : actualOutput,
          expectedOutput: tc.isHidden ? '[hidden]' : expectedOutput,
          isHidden: tc.isHidden,
          errorMessage: tc.isHidden ? 'Runtime error' : result.run.stderr,
        });
      } else {
        testResults.push({
          testCaseId: tc.id,
          passed,
          runtimeMs,
          actualOutput: tc.isHidden ? undefined : actualOutput,
          expectedOutput: tc.isHidden ? '[hidden]' : expectedOutput,
          isHidden: tc.isHidden,
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Piston API error';
      logger.error('Piston execution error', { testCaseId: tc.id, error: message });
      testResults.push({
        testCaseId: tc.id,
        passed: false,
        runtimeMs: 0,
        expectedOutput: tc.isHidden ? '[hidden]' : tc.expectedOutput,
        isHidden: tc.isHidden,
        errorMessage: 'Execution service error',
      });
    }
  }

  const passedCount = testResults.filter((r) => r.passed).length;
  const passRatio = testCases.length > 0 ? passedCount / testCases.length : 0;

  logger.info('Piston execution complete', {
    passed: passedCount,
    total: testCases.length,
    passRatio,
    totalRuntimeMs,
  });

  return { testResults, passRatio, totalRuntimeMs };
}
