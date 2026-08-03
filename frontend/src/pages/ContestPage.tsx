import { useState, useEffect, useRef, useCallback } from 'react';
import { Editor } from '@monaco-editor/react';
import {
  Clock, Send, SkipForward, ChevronRight, CheckCircle2,
  XCircle, AlertCircle, Loader2, Cpu, Star, Code2, LogOut,
  Trophy, Zap
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useContest } from '../contexts/ContestContext';
import { useAntiCheat } from '../hooks/useAntiCheat';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';

const LANGUAGES = [
  { id: 'PYTHON', label: 'Python', monaco: 'python' },
  { id: 'JAVA', label: 'Java', monaco: 'java' },
  { id: 'CPP', label: 'C++', monaco: 'cpp' },
  { id: 'JAVASCRIPT', label: 'JavaScript', monaco: 'javascript' },
];

function formatTime(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

export default function ContestPage() {
  const { user, logout } = useAuth();
  const {
    contestState, remainingMs, currentProblem,
    currentDraft, ap, rank, submissionResult, isJudging, isLocked
  } = useContest();

  const [selectedLang, setSelectedLang] = useState('PYTHON');
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [skipLockoutMs, setSkipLockoutMs] = useState(0);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<any>(null);

  // Enable anti-cheat monitoring
  useAntiCheat(contestState === 'RUNNING' && !isLocked);

  // Initialize code from draft or starter code
  useEffect(() => {
    if (currentDraft) {
      setCode(currentDraft.code);
      setSelectedLang(currentDraft.language);
    } else if (currentProblem?.starterCode?.[selectedLang]) {
      setCode(currentProblem.starterCode[selectedLang]);
    } else {
      setCode('');
    }
  }, [currentProblem?.id, currentDraft]);

  // Update starter code when language changes (only if no draft for the current problem)
  useEffect(() => {
    if (!currentDraft && currentProblem?.starterCode?.[selectedLang]) {
      setCode(currentProblem.starterCode[selectedLang]);
    }
  }, [selectedLang, currentProblem, currentDraft]);

  // Skip lockout countdown
  useEffect(() => {
    if (!currentProblem) return;
    const lockoutMs = 10 * 60 * 1000;
    const elapsed = Date.now() - (currentProblem.assignedAt || Date.now());
    const remaining = Math.max(0, lockoutMs - elapsed);
    setSkipLockoutMs(remaining);

    if (remaining > 0) {
      const interval = setInterval(() => {
        const newRemaining = Math.max(0, lockoutMs - (Date.now() - currentProblem.assignedAt));
        setSkipLockoutMs(newRemaining);
        if (newRemaining <= 0) clearInterval(interval);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [currentProblem?.id]);

  // Debounced auto-save (every 7s)
  const triggerAutoSave = useCallback(
    (newCode: string) => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(async () => {
        if (!currentProblem) return;
        try {
          await api.post('/submissions/draft', {
            problemId: currentProblem.id,
            code: newCode,
            language: selectedLang,
          });
        } catch {
          // Silent fail
        }
      }, 7000);
    },
    [currentProblem, selectedLang]
  );

  const handleCodeChange = (newCode: string | undefined) => {
    const value = newCode || '';
    setCode(value);
    triggerAutoSave(value);
  };

  const handleSubmit = async () => {
    if (!currentProblem || isSubmitting || isJudging || isLocked) return;
    setIsSubmitting(true);
    try {
      await api.post('/submissions/submit', {
        problemId: currentProblem.id,
        code,
        language: selectedLang,
      });
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

  const isPaused = contestState === 'PAUSED';
  const isTimeWarning = remainingMs < 5 * 60 * 1000 && remainingMs > 0;

  return (
    <div className="h-screen flex flex-col bg-surface-950 overflow-hidden">
      {/* Pause Overlay */}
      {isPaused && (
        <div className="pause-overlay animate-fade-in">
          <div className="text-center">
            <div className="text-6xl mb-4">⏸</div>
            <h2 className="text-3xl font-black text-white mb-2">Contest Paused</h2>
            <p className="text-white/50">Waiting for the admin to resume...</p>
          </div>
        </div>
      )}

      {/* Lock Overlay */}
      {isLocked && (
        <div className="pause-overlay animate-fade-in">
          <div className="text-center">
            <div className="text-6xl mb-4">🔒</div>
            <h2 className="text-3xl font-black text-red-400 mb-2">Account Locked</h2>
            <p className="text-white/50">Please contact the administrator.</p>
          </div>
        </div>
      )}

      {/* Top Navigation Bar */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-surface-900/80 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
            <Code2 className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-bold text-white text-sm">CodeArena</span>

          {currentProblem && (
            <>
              <ChevronRight className="w-3.5 h-3.5 text-white/20" />
              <div className="flex items-center gap-2">
                <span className={`badge-${currentProblem.difficulty.toLowerCase()}`}>
                  {currentProblem.difficulty}
                </span>
                <span className="text-white/70 text-sm font-medium truncate max-w-48">
                  {currentProblem.title}
                </span>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-4">
          {/* AP Display */}
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-brand-400" />
            <span className="ap-glow text-lg">{ap.toFixed(0)}</span>
            <span className="text-white/30 text-xs">AP</span>
          </div>

          {/* Rank */}
          {rank > 0 && (
            <div className="flex items-center gap-1.5">
              <Trophy className="w-4 h-4 text-amber-400" />
              <span className="text-white/70 text-sm font-semibold">#{rank}</span>
            </div>
          )}

          {/* Timer */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-mono text-sm font-bold
            ${isTimeWarning ? 'bg-red-500/20 text-red-400 animate-pulse' : 'bg-white/5 text-white/70'}`}>
            <Clock className="w-3.5 h-3.5" />
            {formatTime(remainingMs)}
          </div>

          <button onClick={logout} className="text-white/30 hover:text-white/60 transition-colors">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main content: Problem + Editor side by side */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Problem Statement */}
        <div className="w-2/5 flex flex-col border-r border-white/5 overflow-y-auto">
          {currentProblem ? (
            <div className="p-5 space-y-4">
              <div>
                <h2 className="text-xl font-bold text-white mb-1">{currentProblem.title}</h2>
                <div className="flex items-center gap-2 text-white/40 text-xs">
                  <span className={`badge-${currentProblem.difficulty.toLowerCase()}`}>
                    {currentProblem.difficulty}
                  </span>
                  <span>• {currentProblem.timeBudget} min budget</span>
                  {currentProblem.assignedAt && (
                    <span>• Assigned {formatDistanceToNow(currentProblem.assignedAt)} ago</span>
                  )}
                </div>
              </div>

              {/* Problem statement */}
              <div className="prose prose-invert prose-sm max-w-none">
                <div
                  className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap font-sans"
                  dangerouslySetInnerHTML={{ __html: currentProblem.statement.replace(/\n/g, '<br/>') }}
                />
              </div>

              {/* Sample test cases (visible ones only) */}
              {currentProblem.testCases.filter((tc) => !tc.isHidden).map((tc, idx) => (
                <div key={tc.id} className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
                  <div className="px-3 py-2 border-b border-white/5 text-xs font-semibold text-white/40">
                    Example {idx + 1}
                  </div>
                  <div className="p-3 space-y-2">
                    <div>
                      <span className="text-xs text-white/30 font-medium">Input:</span>
                      <pre className="text-xs text-white/70 font-mono mt-1 bg-black/20 rounded p-2">{tc.input}</pre>
                    </div>
                    <div>
                      <span className="text-xs text-white/30 font-medium">Output:</span>
                      <pre className="text-xs text-white/70 font-mono mt-1 bg-black/20 rounded p-2">{tc.expectedOutput}</pre>
                    </div>
                  </div>
                </div>
              ))}

              {/* Submission Result */}
              {submissionResult && (
                <div className="space-y-3 animate-slide-up">
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold
                    ${submissionResult.passRatio === 1 ? 'bg-emerald-500/20 text-emerald-400' :
                      submissionResult.passRatio > 0 ? 'bg-amber-500/20 text-amber-400' :
                      'bg-red-500/20 text-red-400'}`}>
                    {submissionResult.passRatio === 1 ? <CheckCircle2 className="w-4 h-4" /> :
                     submissionResult.passRatio > 0 ? <AlertCircle className="w-4 h-4" /> :
                     <XCircle className="w-4 h-4" />}
                    {submissionResult.status.replace('_', ' ')} •
                    {Math.round(submissionResult.passRatio * 100)}% tests passed •
                    +{submissionResult.apAwarded.toFixed(0)} AP
                  </div>

                  {submissionResult.compileError && (
                    <pre className="text-xs text-red-400 bg-red-500/10 rounded-lg p-3 overflow-x-auto">
                      {submissionResult.compileError}
                    </pre>
                  )}

                  {/* Test case results */}
                  <div className="space-y-1.5">
                    {submissionResult.testResults.map((tc, idx) => (
                      <div key={tc.testCaseId} className={`flex items-start gap-2 p-2 rounded-lg text-xs
                        ${tc.passed ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                        {tc.passed ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1 min-w-0">
                          <span className={tc.passed ? 'text-emerald-400' : 'text-red-400'}>
                            {tc.isHidden ? `Hidden Test ${idx + 1}` : `Test ${idx + 1}`}
                          </span>
                          <span className="text-white/30 ml-2">{tc.runtimeMs}ms</span>
                          {!tc.passed && !tc.isHidden && tc.actualOutput && (
                            <div className="mt-1 text-white/50">
                              Got: <code className="text-red-400">{tc.actualOutput}</code>
                            </div>
                          )}
                          {tc.errorMessage && (
                            <div className="mt-1 text-red-400/70">{tc.errorMessage}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* AI Score */}
                  {submissionResult.aiScore !== undefined && (
                    <div className="glass-card p-3 border-brand-500/20">
                      <div className="flex items-center gap-2 mb-1">
                        <Cpu className="w-3.5 h-3.5 text-brand-400" />
                        <span className="text-xs font-semibold text-brand-400">AI Logic Review</span>
                        <div className="flex ml-auto">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <Star
                              key={s}
                              className={`w-3 h-3 ${s <= Math.round(submissionResult.aiScore! * 5)
                                ? 'text-brand-400 fill-brand-400' : 'text-white/20'}`}
                            />
                          ))}
                        </div>
                      </div>
                      <p className="text-white/50 text-xs">{submissionResult.aiReasoning}</p>
                      {submissionResult.aiSuggestions && (
                        <p className="text-brand-400/60 text-xs mt-1">💡 {submissionResult.aiSuggestions}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-white/30">
                <Code2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Waiting for problem assignment...</p>
              </div>
            </div>
          )}
        </div>

        {/* Right: Code Editor */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Editor toolbar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-surface-900/50 flex-shrink-0">
            {/* Language selector */}
            <div className="flex gap-1">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.id}
                  onClick={() => setSelectedLang(lang.id)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-all
                    ${selectedLang === lang.id
                      ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30'
                      : 'text-white/40 hover:text-white/70 hover:bg-white/5'}`}
                >
                  {lang.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              {/* Auto-save indicator */}
              <span className="text-white/20 text-xs">Auto-saves every 7s</span>

              {/* Skip button */}
              <button
                onClick={handleSkip}
                disabled={skipLockoutMs > 0 || !currentProblem || isLocked}
                title={skipLockoutMs > 0 ? `Skip available in ${Math.ceil(skipLockoutMs / 60000)}min` : 'Skip problem (0 AP)'}
                className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-30"
              >
                <SkipForward className="w-3.5 h-3.5" />
                {skipLockoutMs > 0 ? `Skip (${Math.ceil(skipLockoutMs / 60000)}m)` : 'Skip'}
              </button>

              {/* Submit button */}
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || isJudging || !currentProblem || isPaused || isLocked}
                className="btn-primary text-sm py-1.5 px-4"
              >
                {isSubmitting || isJudging ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {isJudging ? 'Judging...' : 'Submitting...'}
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    Submit
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Monaco Editor */}
          <div className="flex-1 overflow-hidden">
            <Editor
              height="100%"
              language={LANGUAGES.find((l) => l.id === selectedLang)?.monaco || 'python'}
              value={code}
              onChange={handleCodeChange}
              onMount={(editor) => { editorRef.current = editor; }}
              theme="vs-dark"
              options={{
                fontSize: 14,
                fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                fontLigatures: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                padding: { top: 16, bottom: 16 },
                lineNumbers: 'on',
                renderWhitespace: 'selection',
                cursorSmoothCaretAnimation: 'on',
                smoothScrolling: true,
                readOnly: isPaused || isLocked || contestState === 'ENDED',
                wordWrap: 'on',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
