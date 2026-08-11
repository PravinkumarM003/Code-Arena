import axios from 'axios';
import { logger } from '../config/logger';

// Judge0 CE — free, no API key required
// Docs: https://ce.judge0.com/
const JUDGE0_URL = process.env.JUDGE0_API_URL || 'https://ce.judge0.com';

// Judge0 language IDs for each of our supported languages
// Full list: GET https://ce.judge0.com/languages
const LANGUAGE_MAP: Record<string, { id: number; name: string }> = {
  PYTHON:     { id: 100, name: 'Python (3.12.5)'           },
  JAVA:       { id: 91,  name: 'Java (JDK 17.0.6)'         },
  CPP:        { id: 105, name: 'C++ (GCC 14.1.0)'          },
  C:          { id: 103, name: 'C (GCC 14.1.0)'            },
  JAVASCRIPT: { id: 102, name: 'JavaScript (Node.js 22)'   },
  TYPESCRIPT: { id: 94,  name: 'TypeScript (5.0.3)'        },
  CSHARP:     { id: 51,  name: 'C# (Mono 6.6.0.161)'       },
  GO:         { id: 107, name: 'Go (1.23.5)'               },
  RUST:       { id: 108, name: 'Rust (1.85.0)'             },
  PHP:        { id: 98,  name: 'PHP (8.3.11)'              },
};

// Judge0 status IDs
const STATUS = {
  IN_QUEUE:    1,
  PROCESSING:  2,
  ACCEPTED:    3,
  WRONG_ANSWER: 4,
  TIME_LIMIT:  5,
  COMPILE_ERR: 6,
  RUNTIME_ERR_SIGSEGV: 7,
  RUNTIME_ERR_SIGXFSZ: 8,
  RUNTIME_ERR_SIGFPE:  9,
  RUNTIME_ERR_SIGABRT: 10,
  RUNTIME_ERR_NZEC:    11,
  RUNTIME_ERR_OTHER:   12,
  INTERNAL_ERR: 13,
  EXEC_FORMAT:  14,
} as const;

/** Base64-encode a string (Judge0 requires base64 for source/stdin/stdout) */
function b64(str: string): string {
  return Buffer.from(str, 'utf8').toString('base64');
}

/** Base64-decode a string returned by Judge0 */
function d64(str: string | null | undefined): string {
  if (!str) return '';
  return Buffer.from(str, 'base64').toString('utf8');
}

/**
 * Submit one code execution to Judge0 and poll until it finishes.
 * Returns the decoded stdout, stderr, compile_output and status.
 */
async function runOnce(
  langId: number,
  code: string,
  stdin: string,
  timeLimitSec = 5,
  memLimitKb = 131072   // 128 MB
): Promise<{
  stdout: string;
  stderr: string;
  compileOutput: string;
  statusId: number;
  statusDesc: string;
  runtimeMs: number;
  exitCode: number | null;
}> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  // Submit
  const submitRes = await axios.post(
    `${JUDGE0_URL}/submissions?base64_encoded=true&wait=false`,
    {
      language_id:       langId,
      source_code:       b64(code),
      stdin:             b64(stdin),
      cpu_time_limit:    timeLimitSec,
      memory_limit:      memLimitKb,
    },
    { headers, timeout: 15_000 }
  );

  const token: string = submitRes.data.token;
  if (!token) throw new Error('Judge0 did not return a submission token');

  // Poll until finished (max 20s, 500ms intervals)
  const maxWaitMs = 20_000;
  const pollMs    = 600;
  const started   = Date.now();

  while (Date.now() - started < maxWaitMs) {
    await new Promise((r) => setTimeout(r, pollMs));

    const pollRes = await axios.get(
      `${JUDGE0_URL}/submissions/${token}?base64_encoded=true&fields=status,stdout,stderr,compile_output,time,exit_code`,
      { headers, timeout: 10_000 }
    );

    const d = pollRes.data;
    const statusId: number = d.status?.id ?? 0;

    if (statusId <= STATUS.PROCESSING) continue; // still running

    const runtimeMs = Math.round(parseFloat(d.time || '0') * 1000);

    return {
      stdout:        d64(d.stdout),
      stderr:        d64(d.stderr),
      compileOutput: d64(d.compile_output),
      statusId,
      statusDesc:    d.status?.description ?? 'Unknown',
      runtimeMs,
      exitCode:      d.exit_code ?? (statusId === STATUS.ACCEPTED ? 0 : 1),
    };
  }

  throw new Error('Execution timed out waiting for Judge0 result');
}

// ─── Public API used by /run route ───────────────────────────────────────────

export interface RunResult {
  stdout: string;
  stderr: string;
  compileError: string | null;
  runtimeError: string | null;
  runtimeMs: number;
  exitCode: number;
}

export async function runCode(
  code: string,
  language: string,
  stdin: string
): Promise<RunResult> {
  const lang = LANGUAGE_MAP[language.toUpperCase()];
  if (!lang) throw new Error(`Unsupported language: ${language}`);

  const result = await runOnce(lang.id, code, stdin);

  // Compile error
  if (result.statusId === STATUS.COMPILE_ERR) {
    return {
      stdout: '',
      stderr: '',
      compileError: result.compileOutput || result.stderr || 'Compilation failed',
      runtimeError: null,
      runtimeMs: result.runtimeMs,
      exitCode: 1,
    };
  }

  // Runtime error / time limit
  const isRuntimeError = result.statusId >= STATUS.RUNTIME_ERR_SIGSEGV && result.statusId <= STATUS.RUNTIME_ERR_OTHER;
  const isTimeLimit    = result.statusId === STATUS.TIME_LIMIT;

  const runtimeError = isTimeLimit
    ? `Time Limit Exceeded (limit: 5s)`
    : isRuntimeError
      ? result.stderr || result.statusDesc
      : null;

  return {
    stdout:       result.stdout,
    stderr:       result.statusId === STATUS.ACCEPTED ? result.stderr : '',
    compileError: null,
    runtimeError,
    runtimeMs:    result.runtimeMs,
    exitCode:     result.exitCode ?? (result.statusId === STATUS.ACCEPTED ? 0 : 1),
  };
}

// ─── Public API used by grading worker (test cases) ─────────────────────────

export interface TestCaseResult {
  testCaseId: string;
  passed: boolean;
  runtimeMs: number;
  actualOutput?: string;
  expectedOutput: string;
  isHidden: boolean;
  errorMessage?: string;
}

export interface GradeResult {
  testResults: TestCaseResult[];
  passRatio: number;
  totalRuntimeMs: number;
  compileError?: string;
}

export async function executeCode(
  code: string,
  language: string,
  testCases: Array<{ id: string; input: string; expectedOutput: string; isHidden: boolean; points: number }>
): Promise<GradeResult> {
  const lang = LANGUAGE_MAP[language.toUpperCase()];
  if (!lang) throw new Error(`Unsupported language: ${language}`);

  const testResults: TestCaseResult[] = [];
  let totalRuntimeMs = 0;

  for (const tc of testCases) {
    try {
      const result = await runOnce(lang.id, code, tc.input);
      totalRuntimeMs += result.runtimeMs;

      // Compile error — stop testing immediately
      if (result.statusId === STATUS.COMPILE_ERR) {
        const compileErr = result.compileOutput || result.stderr || 'Compilation failed';
        testResults.push({
          testCaseId: tc.id,
          passed: false,
          runtimeMs: result.runtimeMs,
          expectedOutput: tc.isHidden ? '[hidden]' : tc.expectedOutput,
          isHidden: tc.isHidden,
          errorMessage: tc.isHidden ? 'Compile error' : compileErr,
        });
        return {
          testResults,
          passRatio: 0,
          totalRuntimeMs,
          compileError: compileErr,
        };
      }

      // Runtime error or TLE
      const isErr = result.statusId !== STATUS.ACCEPTED && result.statusId !== STATUS.WRONG_ANSWER;
      if (isErr) {
        const errMsg = result.statusId === STATUS.TIME_LIMIT
          ? 'Time Limit Exceeded'
          : result.stderr || result.statusDesc;
        testResults.push({
          testCaseId: tc.id,
          passed: false,
          runtimeMs: result.runtimeMs,
          expectedOutput: tc.isHidden ? '[hidden]' : tc.expectedOutput,
          isHidden: tc.isHidden,
          errorMessage: tc.isHidden ? 'Runtime error' : errMsg,
        });
        continue;
      }

      const actualOutput   = result.stdout.trim();
      const expectedOutput = tc.expectedOutput.trim();
      const passed         = actualOutput === expectedOutput;

      testResults.push({
        testCaseId: tc.id,
        passed,
        runtimeMs: result.runtimeMs,
        actualOutput:    tc.isHidden ? undefined : actualOutput,
        expectedOutput:  tc.isHidden ? '[hidden]' : expectedOutput,
        isHidden:        tc.isHidden,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Execution error';
      logger.error('Judge0 execution error', { testCaseId: tc.id, error: message });
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
  const passRatio   = testCases.length > 0 ? passedCount / testCases.length : 0;

  logger.info('Judge0 execution complete', {
    passed: passedCount,
    total: testCases.length,
    passRatio,
    totalRuntimeMs,
  });

  return { testResults, passRatio, totalRuntimeMs };
}
