import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
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
  eventMode: 'INDIVIDUAL' | 'GROUP';
  isSessionRestored: boolean;
  teamInvites: Array<{ inviteId: string; teamId: string; teamName: string; inviterName: string }>;
  eventId: string | null;
  teamRefreshTick: number;
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
  const [eventMode, setEventMode] = useState<'INDIVIDUAL' | 'GROUP'>('INDIVIDUAL');
  const [isSessionRestored, setIsSessionRestored] = useState(false);
  const [teamInvites, setTeamInvites] = useState<Array<{ inviteId: string; teamId: string; teamName: string; inviterName: string }>>([]);
  const [eventId, setEventId] = useState<string | null>(null);
  const [teamRefreshTick, setTeamRefreshTick] = useState(0);

  // Ref to track the socket across closures — prevents the stale-closure bug
  // where cleanup captured `socket === null` because setSocket hadn't run yet.
  const socketRef = useRef<Socket | null>(null);

  // Countdown timer (purely display — server is the source of truth)
  useEffect(() => {
    if (!endTime || contestState !== 'RUNNING') return;

    const interval = setInterval(() => {
      const remaining = Math.max(0, endTime - Date.now());
      setRemainingMs(remaining);
    }, 1000);

    return () => clearInterval(interval);
  }, [endTime, contestState]);

  // ── Main socket lifecycle effect ───────────────────────────────────────────
  // All socket creation, listener setup, and teardown happens in ONE effect.
  // The ref ensures cleanup always has the correct socket reference.
  useEffect(() => {
    // Guard: no user → disconnect and reset
    if (!user) {
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      disconnectSocket();
      setSocket(null);
      setContestState('WAITING');
      setCurrentProblem(null);
      setCurrentDraft(null);
      setTeamInvites([]);
      setIsSessionRestored(false);
      setEventMode('INDIVIDUAL');
      setAp(0);
      setRank(0);
      setAnnouncement(null);
      setSubmissionResult(null);
      setIsJudging(false);
      setIsLocked(false);
      setEndTime(null);
      setRemainingMs(0);
      setConnectedCount(0);
      setEventId(null);
      return;
    }

    // Mounted flag prevents state updates after unmount (React StrictMode safety)
    let mounted = true;

    async function connect() {
      try {
        const sock = await getSocket();

        // If the component unmounted while we were awaiting getSocket(), bail out.
        // This handles the React StrictMode rapid mount→unmount→remount cycle.
        if (!mounted) {
          return;
        }

        // Store in ref AND state
        socketRef.current = sock;
        setSocket(sock);

        // ── Contest State ──────────────────────────────────────────────────
        sock.on('contest:state', (data: { state: ContestState; endTime?: number; remainingMs?: number; eventId?: string; mode?: 'INDIVIDUAL' | 'GROUP' }) => {
          if (!mounted) return;
          setContestState(data.state);
          if (data.endTime) setEndTime(data.endTime);
          if (data.remainingMs !== undefined) setRemainingMs(data.remainingMs);
          if (data.eventId) setEventId(data.eventId);
          if (data.mode) setEventMode(data.mode);
        });

        sock.on('contest:connected', (data: { count: number }) => {
          if (!mounted) return;
          setConnectedCount(data.count);
        });

        sock.on('contest:extended', (data: { newEndTime: number }) => {
          if (!mounted) return;
          setEndTime(data.newEndTime);
          toast.success('⏱ Contest time extended!');
        });

        sock.on('contest:announcement', (data: { message: string | null }) => {
          if (!mounted) return;
          setAnnouncement(data.message);
          if (data.message) {
            toast(data.message, { icon: '📢', duration: 10000 });
          }
        });

        sock.on('contest:started', (data?: { endTime?: number; remainingMs?: number; eventId?: string; mode?: 'INDIVIDUAL' | 'GROUP' }) => {
          if (!mounted) return;
          // Immediately mark contest as RUNNING so the client navigates to /contest
          setContestState('RUNNING');
          if (data?.endTime) setEndTime(data.endTime);
          if (data?.remainingMs !== undefined) setRemainingMs(data.remainingMs);
          if (data?.eventId) setEventId(data.eventId);
          if (data?.mode) setEventMode(data.mode);
          // Request our assigned problem from the server
          sock.emit('session:restore');
          toast.success('🚀 Contest has started! Loading your problem...', { duration: 5000 });
        });

        // ── Session Restore ────────────────────────────────────────────────
        sock.on('session:restored', (data: {
          state: ContestState;
          remainingMs: number;
          endTime?: number;       // absolute epoch ms for the countdown timer
          problem: Problem | null;
          draft: { code: string; language: string } | null;
          ap: number;
          rank: number;
          isLocked?: boolean;
          mode?: 'INDIVIDUAL' | 'GROUP';
          eventId?: string;
        }) => {
          if (!mounted) return;
          setContestState(data.state);
          setRemainingMs(data.remainingMs);
          if (data.endTime) setEndTime(data.endTime);  // keeps countdown accurate after reconnect
          setCurrentProblem(data.problem);
          setCurrentDraft(data.draft);
          setAp(data.ap);
          setRank(data.rank);
          if (data.isLocked !== undefined) {
            setIsLocked(data.isLocked);
          }
          if (data.mode) {
            setEventMode(data.mode);
          }
          if (data.eventId) {
            setEventId(data.eventId);
          }
          setIsSessionRestored(true);
        });

        // ── Submission Events ──────────────────────────────────────────────
        sock.on('submission:judging', () => {
          if (!mounted) return;
          setIsJudging(true);
          setSubmissionResult(null);
        });

        sock.on('submission:testResults', (result: SubmissionResult) => {
          if (!mounted) return;
          setSubmissionResult(result);
          setIsJudging(false);
        });

        sock.on('submission:result', (result: SubmissionResult) => {
          if (!mounted) return;
          setSubmissionResult(result);
          setIsJudging(false);
          if (result.apAwarded > 0) {
            setAp((prev) => prev + result.apAwarded);
            toast.success(`+${result.apAwarded.toFixed(0)} AP earned!`);
          }
          // If fully solved, problem will be updated via session:restored
          if (result.passRatio === 1) {
            setTimeout(() => {
              sock.emit('session:restore');
            }, 3000);
          }
        });

        sock.on('submission:error', (data: { error: string }) => {
          if (!mounted) return;
          setIsJudging(false);
          toast.error(data.error);
        });

        // ── AP Updates ─────────────────────────────────────────────────────
        sock.on('ap:adjusted', (data: { newAP: number; reason: string }) => {
          if (!mounted) return;
          setAp(data.newAP);
          toast(`AP adjusted: ${data.newAP}. Reason: ${data.reason}`, { icon: 'ℹ️' });
        });

        // ── Anti-Cheat ─────────────────────────────────────────────────────
        sock.on('anticheat:warning', (data: { message: string }) => {
          if (!mounted) return;
          toast.error(`⚠️ ${data.message}`, { duration: 8000 });
        });

        sock.on('anticheat:penalty', (data: { message: string; newAP: number }) => {
          if (!mounted) return;
          setAp(data.newAP);
          toast.error(`🚨 ${data.message}`, { duration: 8000 });
        });

        sock.on('anticheat:locked', (data: { message: string }) => {
          if (!mounted) return;
          setIsLocked(true);
          toast.error(`🔒 ${data.message}`, { duration: Infinity });
        });

        sock.on('anticheat:unlocked', () => {
          if (!mounted) return;
          setIsLocked(false);
          toast.dismiss();
          toast.success(`🔓 Account unlocked. You may resume.`);
          sock.emit('session:restore');
        });

        // ── Team Events ───────────────────────────────────────────────────
        sock.on('team:invite', (data: { inviteId: string; teamId: string; teamName: string; inviterName: string }) => {
          if (!mounted) return;
          setTeamInvites((prev) => [...prev, data]);
          toast(`👥 ${data.inviterName} invited you to join "${data.teamName}"`, { icon: '📨', duration: 10000 });
        });

        sock.on('team:accepted', (data: { userName: string }) => {
          if (!mounted) return;
          toast.success(`✅ ${data.userName} joined your team!`);
        });

        sock.on('team:rejected', (data: { userName: string }) => {
          if (!mounted) return;
          toast(`❌ ${data.userName} declined the invite`, { icon: '😞' });
        });

        sock.on('team:disbanded', (data: { teamName: string }) => {
          if (!mounted) return;
          toast.error(`Team "${data.teamName}" was disbanded`);
        });

        sock.on('team:update', () => {
          if (!mounted) return;
          setTeamInvites(prev => [...prev]);
          setTeamRefreshTick(prev => prev + 1);
        });

        sock.on('contest:mode', (data: { mode: 'INDIVIDUAL' | 'GROUP' }) => {
          if (!mounted) return;
          setEventMode(data.mode);
        });

        // ── Reconnect: restore state from server ───────────────────────────
        sock.on('connect', () => {
          if (!mounted) return;
          sock.emit('session:restore');
        });

        sock.on('reconnect', (attempt: number) => {
          if (!mounted) return;
          toast.success(`Reconnected (attempt ${attempt})`);
          sock.emit('session:restore');
        });

        sock.on('connect_error', (err) => {
          console.error('Socket connect error:', err.message);
        });

      } catch (err) {
        console.error('Failed to connect socket:', err);
      }
    }

    connect();

    // ── Cleanup: runs on unmount or when `user` changes ────────────────────
    return () => {
      mounted = false;

      // Use the ref — guaranteed to be the actual socket (not a stale closure)
      const sock = socketRef.current;
      if (sock) {
        sock.off('contest:state');
        sock.off('contest:connected');
        sock.off('contest:extended');
        sock.off('contest:announcement');
        sock.off('contest:started');
        sock.off('session:restored');
        sock.off('submission:judging');
        sock.off('submission:testResults');
        sock.off('submission:result');
        sock.off('submission:error');
        sock.off('ap:adjusted');
        sock.off('anticheat:warning');
        sock.off('anticheat:penalty');
        sock.off('anticheat:locked');
        sock.off('anticheat:unlocked');
        sock.off('connect');
        sock.off('reconnect');
        sock.off('connect_error');
        sock.off('team:invite');
        sock.off('team:accepted');
        sock.off('team:rejected');
        sock.off('team:disbanded');
        sock.off('team:update');
        sock.off('contest:mode');
      }
      socketRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

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
      isSessionRestored,
      eventMode,
      teamInvites,
      eventId,
      teamRefreshTick,
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
