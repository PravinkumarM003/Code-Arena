import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { getSocket, disconnectSocket } from '../lib/socket';
import { useAuth } from './AuthContext';
import toast from 'react-hot-toast';

export type ContestState = 'WAITING' | 'RUNNING' | 'PAUSED' | 'ENDED';

export interface Problem {
  id: string;
  title: string;
  statement: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  timeBudget: number;
  starterCode: Record<string, string>;
  testCases: Array<{
    id: string;
    input: string;
    expectedOutput: string;
    isHidden: boolean;
    points: number;
  }>;
  assignedAt: number;
}

export interface TestResult {
  testCaseId: string;
  passed: boolean;
  runtimeMs: number;
  actualOutput?: string;
  expectedOutput: string;
  isHidden: boolean;
  errorMessage?: string;
}

export interface SubmissionResult {
  submissionId: string;
  testResults: TestResult[];
  passRatio: number;
  status: string;
  apAwarded: number;
  aiScore?: number;
  aiReasoning?: string;
  aiSuggestions?: string;
  compileError?: string;
}

interface ContestContextType {
  socket: Socket | null;
  contestState: ContestState;
  endTime: number | null;
  remainingMs: number;
  connectedCount: number;
  currentProblem: Problem | null;
  currentDraft: { code: string; language: string } | null;
  ap: number;
  rank: number;
  submissionResult: SubmissionResult | null;
  isJudging: boolean;
  announcement: string | null;
  isLocked: boolean;
}

const ContestContext = createContext<ContestContextType | null>(null);

export function ContestProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [contestState, setContestState] = useState<ContestState>('WAITING');
  const [endTime, setEndTime] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [connectedCount, setConnectedCount] = useState(0);
  const [currentProblem, setCurrentProblem] = useState<Problem | null>(null);
  const [currentDraft, setCurrentDraft] = useState<{ code: string; language: string } | null>(null);
  const [ap, setAp] = useState(0);
  const [rank, setRank] = useState(0);
  const [submissionResult, setSubmissionResult] = useState<SubmissionResult | null>(null);
  const [isJudging, setIsJudging] = useState(false);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  // Countdown timer (purely display — server is the source of truth)
  useEffect(() => {
    if (!endTime || contestState !== 'RUNNING') return;

    const interval = setInterval(() => {
      const remaining = Math.max(0, endTime - Date.now());
      setRemainingMs(remaining);
      if (remaining <= 0) {
        setContestState('ENDED');
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [endTime, contestState]);

  const connectSocket = useCallback(async () => {
    if (!user) return;

    try {
      const sock = await getSocket();
      setSocket(sock);

      // ── Contest State ────────────────────────────────────────────────
      sock.on('contest:state', (data: { state: ContestState; endTime?: number; remainingMs?: number }) => {
        setContestState(data.state);
        if (data.endTime) setEndTime(data.endTime);
        if (data.remainingMs !== undefined) setRemainingMs(data.remainingMs);
      });

      sock.on('contest:connected', (data: { count: number }) => {
        setConnectedCount(data.count);
      });

      sock.on('contest:extended', (data: { newEndTime: number }) => {
        setEndTime(data.newEndTime);
        toast.success('⏱ Contest time extended!');
      });

      sock.on('contest:announcement', (data: { message: string }) => {
        setAnnouncement(data.message);
        toast(data.message, { icon: '📢', duration: 10000 });
      });

      sock.on('contest:started', () => {
        // Server will emit session:restored with the first problem
        toast.success('🚀 Contest has started!', { duration: 5000 });
      });

      // ── Session Restore ──────────────────────────────────────────────
      sock.on('session:restored', (data: {
        state: ContestState;
        remainingMs: number;
        problem: Problem | null;
        draft: { code: string; language: string } | null;
        ap: number;
        rank: number;
      }) => {
        setContestState(data.state);
        setRemainingMs(data.remainingMs);
        setCurrentProblem(data.problem);
        setCurrentDraft(data.draft);
        setAp(data.ap);
        setRank(data.rank);
      });

      // ── Submission Events ────────────────────────────────────────────
      sock.on('submission:judging', () => {
        setIsJudging(true);
        setSubmissionResult(null);
      });

      sock.on('submission:testResults', (result: SubmissionResult) => {
        setSubmissionResult(result);
        setIsJudging(false);
      });

      sock.on('submission:result', (result: SubmissionResult) => {
        setSubmissionResult(result);
        setIsJudging(false);
        if (result.apAwarded > 0) {
          setAp((prev) => prev + result.apAwarded);
          toast.success(`+${result.apAwarded.toFixed(0)} AP earned!`);
        }
        // If fully solved, problem will be updated via session:restored
        if (result.passRatio === 1) {
          setTimeout(async () => {
            sock.emit('session:restore');
          }, 2000);
        }
      });

      sock.on('submission:error', (data: { error: string }) => {
        setIsJudging(false);
        toast.error(data.error);
      });

      // ── AP Updates ───────────────────────────────────────────────────
      sock.on('ap:adjusted', (data: { newAP: number; reason: string }) => {
        setAp(data.newAP);
        toast(`AP adjusted: ${data.newAP}. Reason: ${data.reason}`, { icon: 'ℹ️' });
      });

      // ── Anti-Cheat ───────────────────────────────────────────────────
      sock.on('anticheat:warning', (data: { message: string }) => {
        toast.error(`⚠️ ${data.message}`, { duration: 8000 });
      });

      sock.on('anticheat:penalty', (data: { message: string; newAP: number }) => {
        setAp(data.newAP);
        toast.error(`🚨 ${data.message}`, { duration: 8000 });
      });

      sock.on('anticheat:locked', (data: { message: string }) => {
        setIsLocked(true);
        toast.error(`🔒 ${data.message}`, { duration: Infinity });
      });

      // ── Reconnect: restore state from server ─────────────────────────
      sock.on('connect', () => {
        sock.emit('session:restore');
      });

      sock.on('reconnect', (attempt: number) => {
        toast.success(`Reconnected (attempt ${attempt})`);
        sock.emit('session:restore');
      });

      sock.on('connect_error', (err) => {
        console.error('Socket connect error:', err.message);
      });

    } catch (err) {
      console.error('Failed to connect socket:', err);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      connectSocket();
    } else {
      disconnectSocket();
      setSocket(null);
      setContestState('WAITING');
      setCurrentProblem(null);
    }

    return () => {
      // Don't disconnect on re-render, only on unmount
    };
  }, [user, connectSocket]);

  return (
    <ContestContext.Provider value={{
      socket,
      contestState,
      endTime,
      remainingMs,
      connectedCount,
      currentProblem,
      currentDraft,
      ap,
      rank,
      submissionResult,
      isJudging,
      announcement,
      isLocked,
    }}>
      {children}
    </ContestContext.Provider>
  );
}

export function useContest() {
  const ctx = useContext(ContestContext);
  if (!ctx) throw new Error('useContest must be used within ContestProvider');
  return ctx;
}
