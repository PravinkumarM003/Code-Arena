import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useFullscreen } from '../hooks/useFullscreen';
import { Clock, SkipForward, ChevronRight, Trophy, Zap, Code2 } from 'lucide-react';
import { useContest } from '../contexts/ContestContext';
import { useAntiCheat } from '../hooks/useAntiCheat';
import api from '../lib/api';
import toast from 'react-hot-toast';
import OnlineGDBCompiler from '../components/OnlineGDBCompiler';


function formatTime(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

export default function ContestPage() {
  const {
    contestState, remainingMs, currentProblem,
    currentDraft, ap, rank, submissionResult, isJudging, isLocked
  } = useContest();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [skipLockoutMs, setSkipLockoutMs] = useState(0);
  const [currentCode, setCurrentCode] = useState('');
  const [currentLanguage, setCurrentLanguage] = useState('CPP');
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isPaused = contestState === 'PAUSED';

  // Enable anti-cheat monitoring
  useAntiCheat(contestState === 'RUNNING' && !isLocked);

  // Fullscreen enforcement: enter on RUNNING, exit on PAUSED/ENDED
  useFullscreen(contestState === 'RUNNING' && !isPaused);

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

  // Debounced auto-save (every 7s)
  const handleCodeChange = useCallback(
    (newCode: string, lang: string) => {
      setCurrentCode(newCode);
      setCurrentLanguage(lang);

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
      }, 7000);
    },
    [currentProblem]
  );

  const handleSubmit = async () => {
    if (!currentProblem || isSubmitting || isJudging || isLocked) return;
    setIsSubmitting(true);
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

  const handleSkip = async () => {
    if (!currentProblem || skipLockoutMs > 0) return;
    if (!confirm('Skip this problem? You will get 0 AP and cannot return to it.')) return;
    try {
      await api.post('/problems/skip', { problemId: currentProblem.id });
      toast('Problem skipped. Next problem loading...', { icon: '⏭' });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Skip failed');
    }
  };

  const isEnded = contestState === 'ENDED';
  const isTimeWarning = remainingMs < 5 * 60 * 1000 && remainingMs > 0;

  // While contest is running but problem hasn't loaded yet (gap between contest:started and session:restored)
  if (contestState === 'RUNNING' && !currentProblem && !isLocked) {
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
              onClick={handleSkip}
              disabled={skipLockoutMs > 0 || isLocked}
              title={skipLockoutMs > 0 ? `Skip available in ${Math.ceil(skipLockoutMs / 60000)}min` : 'Skip problem (0 AP)'}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-mono text-white/60 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-30 transition-colors"
            >
              <SkipForward className="w-3 h-3" />
              {skipLockoutMs > 0 ? `Skip (${Math.ceil(skipLockoutMs / 60000)}m)` : 'Skip'}
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
          isSubmitting={isSubmitting}
          isJudging={isJudging}
          submissionResult={submissionResult}
          isLocked={isLocked}
          isPaused={isPaused}
        />
      </div>
    </div>
  );
}
