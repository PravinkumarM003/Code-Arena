import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useFullscreen } from '../hooks/useFullscreen';
import { Clock, SkipForward, ChevronRight, Trophy, Zap, Code2, Maximize2 } from 'lucide-react';
import { useContest } from '../contexts/ContestContext';
import { useAntiCheat } from '../hooks/useAntiCheat';
import api from '../lib/api';
import toast from 'react-hot-toast';
import OnlineGDBCompiler from '../components/OnlineGDBCompiler';
import TeamFormation from './TeamFormation';
import { formatTime } from '../lib/formatTime';
import { ConfirmModal } from '../components/ConfirmModal';

export default function ContestPage() {
  const {
    contestState, remainingMs, currentProblem,
    currentDraft, ap, rank, submissionResult, isJudging, isLocked, eventMode, socket,
    loadNextProblem
  } = useContest();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitCooldown, setSubmitCooldown] = useState(0);
  const [isSkipping, setIsSkipping] = useState(false);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const [skipLockoutMs, setSkipLockoutMs] = useState(0);
  const [currentCode, setCurrentCode] = useState('');
  const [currentLanguage, setCurrentLanguage] = useState('CPP');
  const [isConnected, setIsConnected] = useState(true);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isPaused = contestState === 'PAUSED';

  // Monitor socket connection state
  useEffect(() => {
    if (!socket) return;
    setIsConnected(socket.connected);

    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [socket]);

  // Enable anti-cheat monitoring
  useAntiCheat(contestState === 'RUNNING' && !isLocked);

  // Fullscreen enforcement: enter on RUNNING, exit on PAUSED/ENDED
  const { isFullscreen, enterFullscreen } = useFullscreen(contestState === 'RUNNING' && !isPaused);

  // Cleanup autoSaveTimer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, []);

  // Submit cooldown timer
  useEffect(() => {
    if (submitCooldown <= 0) return;
    const timer = setInterval(() => {
      setSubmitCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [submitCooldown]);

  // Load draft from localStorage on problem load if available
  useEffect(() => {
    if (!currentProblem) return;
    try {
      const localDraftRaw = localStorage.getItem(`draft:${currentProblem.id}`);
      if (localDraftRaw) {
        const parsed = JSON.parse(localDraftRaw);
        if (parsed.code) {
          setCurrentCode(parsed.code);
          if (parsed.language) setCurrentLanguage(parsed.language);
          return;
        }
      }
    } catch {
      // Ignore localStorage error
    }

    if (currentDraft?.code) {
      setCurrentCode(currentDraft.code);
      if (currentDraft.language) setCurrentLanguage(currentDraft.language);
    }
  }, [currentProblem?.id, currentDraft]);

  // Skip lockout countdown
  useEffect(() => {
    if (!currentProblem) return;
    const lockoutMs = 10 * 60 * 1000;
    // Capture assignedAt so the interval callback doesn't rely on a potentially-stale closure
    const assignedAt = currentProblem.assignedAt || Date.now();
    const elapsed = Date.now() - assignedAt;
    const remaining = Math.max(0, lockoutMs - elapsed);
    setSkipLockoutMs(remaining);

    if (remaining > 0) {
      const interval = setInterval(() => {
        const newRemaining = Math.max(0, lockoutMs - (Date.now() - assignedAt));
        setSkipLockoutMs(newRemaining);
        if (newRemaining <= 0) clearInterval(interval);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [currentProblem?.id]);

  // Dual-tier auto-save: instant localStorage + debounced server sync (5s)
  const handleCodeChange = useCallback(
    (newCode: string, lang: string) => {
      setCurrentCode(newCode);
      setCurrentLanguage(lang);

      // Instant local persistence
      if (currentProblem) {
        try {
          localStorage.setItem(
            `draft:${currentProblem.id}`,
            JSON.stringify({ code: newCode, language: lang, updatedAt: Date.now() })
          );
        } catch {
          // Ignore localStorage quota errors
        }
      }

      // Debounced server sync
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(async () => {
        if (!currentProblem) return;
        try {
          await api.post('/submissions/draft', {
            problemId: currentProblem.id,
            code: newCode,
            language: lang,
          });
        } catch {
          // Silent fail
        }
      }, 5000);
    },
    [currentProblem]
  );

  const handleSubmit = async () => {
    if (!currentProblem || isSubmitting || isJudging || isLocked || submitCooldown > 0) return;
    if (!currentCode.trim()) {
      toast.error('Please write some code before submitting.');
      return;
    }
    setIsSubmitting(true);
    setSubmitCooldown(3); // 3-second cooldown to prevent double submissions
    try {
      await api.post('/submissions/submit', {
        problemId: currentProblem.id,
        code: currentCode,
        language: currentLanguage,
      });
      toast.success('Submission sent for evaluation');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Submission failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkipClick = () => {
    if (!currentProblem || skipLockoutMs > 0 || isSkipping || isLocked) return;
    setShowSkipConfirm(true);
  };

  const handleConfirmSkip = async () => {
    setShowSkipConfirm(false);
    if (!currentProblem || skipLockoutMs > 0 || isSkipping || isLocked) return;
    setIsSkipping(true);
    try {
      await api.post('/problems/skip', { problemId: currentProblem.id });
      toast('Problem skipped. Next problem loading...', { icon: '⏭' });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Skip failed');
    } finally {
      setIsSkipping(false);
    }
  };

  const isEnded = contestState === 'ENDED';
  const isTimeWarning = remainingMs < 5 * 60 * 1000 && remainingMs > 0;

  // While contest is running but problem hasn't loaded yet (gap between contest:started and session:restored)
  if (contestState === 'RUNNING' && !currentProblem && !isLocked) {
    // If it's a GROUP contest and they don't have a problem, they likely need to form a team first.
    if (eventMode === 'GROUP') {
      return (
        <div className="h-screen bg-surface-950 overflow-y-auto py-12 custom-scrollbar">
          <div className="max-w-4xl mx-auto px-4">
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-4 mb-6 text-center animate-fade-in">
              <h2 className="text-xl font-bold text-purple-400 mb-1">Group Event Started!</h2>
              <p className="text-white/60 text-sm">Please form or join a team below. Once your team is ready, you will automatically be assigned your first problem.</p>
            </div>
            <TeamFormation />
          </div>
        </div>
      );
    }

    return (
      <div className="h-screen flex flex-col items-center justify-center bg-surface-950 text-white gap-6">
        <div className="flex flex-col items-center gap-4 glass-card p-10 max-w-sm w-full text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-xl shadow-emerald-500/30 animate-pulse">
            <Code2 className="w-8 h-8 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white mb-1">Loading Your Problem</h2>
            <p className="text-white/40 text-sm">The server is assigning your first problem...</p>
          </div>
          <div className="flex items-center gap-2 text-emerald-400 text-sm font-mono animate-pulse">
            <Clock className="w-4 h-4" />
            <span>Please wait a moment</span>
          </div>
          <div className="w-full bg-white/5 rounded-full h-1 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full animate-pulse w-2/3" />
          </div>

          <div className="flex flex-col gap-2 w-full pt-2">
            <button
              onClick={() => {
                socket?.emit('session:restore');
                toast.success('Refreshing assignment status...');
              }}
              className="w-full py-2.5 px-4 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-all cursor-pointer"
            >
              🔄 Refresh Assignment
            </button>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div className="h-screen flex flex-col bg-surface-950 overflow-hidden font-sans">
      {/* Pause Overlay */}
      {isPaused && (
        <div className="pause-overlay animate-fade-in z-50">
          <div className="text-center">
            <div className="text-6xl mb-4">⏸</div>
            <h2 className="text-3xl font-black text-white mb-2">Contest Paused</h2>
            <p className="text-white/50">Waiting for the admin to resume...</p>
          </div>
        </div>
      )}

      {/* Lock Overlay */}
      {isLocked && (
        <div className="pause-overlay animate-fade-in z-50">
          <div className="text-center">
            <div className="text-6xl mb-4">🔒</div>
            <h2 className="text-3xl font-black text-red-400 mb-2">Account Locked</h2>
            <p className="text-white/50">Please contact the administrator.</p>
          </div>
        </div>
      )}

      {/* Contest Ended Overlay */}
      {isEnded && (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center text-center p-6 backdrop-blur-md">
          <div className="text-6xl mb-4">🏁</div>
          <h2 className="text-3xl font-black text-white mb-2">Contest Ended</h2>
          <p className="text-white/60 mb-6">Thank you for participating! Results are being finalized.</p>
          <a href="/leaderboard" className="px-6 py-3 rounded-xl bg-brand-600 text-white font-bold hover:bg-brand-500 transition-colors">View Leaderboard</a>
        </div>
      )}

      {/* Fullscreen Required Overlay */}
      {!isFullscreen && contestState === 'RUNNING' && !isPaused && !isLocked && (
        <div className="fixed inset-0 z-[100] bg-[#0a0f1a]/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center animate-fade-in select-none">
          <div className="w-20 h-20 rounded-3xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mb-6 shadow-2xl shadow-emerald-500/20 animate-pulse">
            <Maximize2 className="w-10 h-10 text-emerald-400" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-2">Fullscreen Mode Required</h2>
          <p className="text-white/60 text-sm sm:text-base max-w-md mb-6">
            CodeArena requires fullscreen mode for secure contest operation. Click the button below to enter fullscreen and continue.
          </p>
          <button
            onClick={enterFullscreen}
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold text-sm shadow-lg shadow-emerald-500/30 hover:scale-105 active:scale-95 transition-all flex items-center gap-2 cursor-pointer"
          >
            <Maximize2 className="w-4 h-4" />
            Enter Fullscreen Mode
          </button>
        </div>
      )}

      {/* Network / Disconnection Warning */}
      {!isConnected && (
        <div className="bg-amber-500/20 border-b border-amber-500/30 text-amber-300 text-xs px-4 py-1.5 flex items-center justify-center gap-2 font-medium animate-pulse z-30">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
          <span>Connection interrupted. Reconnecting to CodeArena... Your code is safely saved locally.</span>
        </div>
      )}

      {/* Top Banner with Contest Stats */}
      <header className="flex items-center justify-between px-4 py-1.5 border-b border-white/10 bg-[#161b22] text-white flex-shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center shadow-md">
            <Code2 className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-white text-sm font-mono tracking-wide">CodeArena</span>

          {currentProblem && (
            <>
              <ChevronRight className="w-3.5 h-3.5 text-white/20" />
              <div className="flex items-center gap-2">
                <span className={`badge-${currentProblem.difficulty.toLowerCase()}`}>
                  {currentProblem.difficulty}
                </span>
                <span className="text-white/80 text-xs font-semibold truncate max-w-48">
                  {currentProblem.title}
                </span>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-4">
          {/* AP Display */}
          <div className="flex items-center gap-1.5 bg-white/5 px-2.5 py-1 rounded-md border border-white/10">
            <Zap className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400" />
            <span className="text-emerald-400 font-mono font-bold text-sm">{ap.toFixed(0)}</span>
            <span className="text-white/30 text-[10px] font-mono">AP</span>
          </div>

          {/* Rank */}
          {rank > 0 && (
            <div className="flex items-center gap-1.5 bg-white/5 px-2.5 py-1 rounded-md border border-white/10">
              <Trophy className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-white/80 text-xs font-mono font-bold">#{rank}</span>
            </div>
          )}

          {/* Timer */}
          <div className={`flex items-center gap-2 px-3 py-1 rounded-md font-mono text-xs font-bold border
            ${isTimeWarning ? 'bg-red-500/20 text-red-400 border-red-500/30 animate-pulse' : 'bg-white/5 text-white/80 border-white/10'}`}>
            <Clock className="w-3.5 h-3.5" />
            {formatTime(remainingMs)}
          </div>

          {/* Skip Button */}
          {currentProblem && (
            <button
              onClick={handleSkipClick}
              disabled={skipLockoutMs > 0 || isLocked || isSkipping}
              title={skipLockoutMs > 0 ? `Skip available in ${Math.ceil(skipLockoutMs / 1000)}s` : 'Skip problem (0 AP)'}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-mono text-white/60 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-30 transition-colors"
            >
              <SkipForward className="w-3 h-3" />
              {skipLockoutMs > 0 ? `Skip (${Math.ceil(skipLockoutMs / 1000)}s)` : 'Skip'}
            </button>
          )}

        </div>
      </header>

      {/* Main Body: Full OnlineGDB Compiler */}
      <div className="flex-1 overflow-hidden">
        <OnlineGDBCompiler
          problem={currentProblem}
          draftCode={currentDraft?.code}
          draftLanguage={currentDraft?.language}
          onCodeChange={handleCodeChange}
          onSubmitCode={handleSubmit}
          onNextProblem={loadNextProblem}
          isSubmitting={isSubmitting}
          isJudging={isJudging}
          submissionResult={submissionResult}
          isLocked={isLocked}
          isPaused={isPaused}
        />
      </div>

      <ConfirmModal
        isOpen={showSkipConfirm}
        title="Skip Problem"
        message="Skip this problem? You will get 0 AP and cannot return to it."
        confirmLabel="Skip Problem"
        cancelLabel="Cancel"
        isDestructive={true}
        onConfirm={handleConfirmSkip}
        onCancel={() => setShowSkipConfirm(false)}
      />
    </div>
  );
}
