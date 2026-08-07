import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Editor } from '@monaco-editor/react';
import {
  Play, Send, Terminal, Sparkles, Download, Upload, Copy, Settings,
  Maximize2, Minimize2, Trash2, CheckCircle2, XCircle, AlertCircle,
  Loader2, ChevronRight, FileCode, Check, RefreshCw, PanelLeftClose, PanelLeft,
  BookOpen, Sliders, ShieldAlert, Cpu, Star
} from 'lucide-react';
import { LANGUAGES, LanguageConfig } from '../lib/languages';
import api from '../lib/api';
import toast from 'react-hot-toast';

export interface TestCaseResult {
  testCaseId: string;
  passed: boolean;
  runtimeMs: number;
  actualOutput?: string;
  expectedOutput: string;
  isHidden: boolean;
  errorMessage?: string;
}

export interface SubmissionResultData {
  passRatio: number;
  status: string;
  apAwarded: number;
  compileError?: string | null;
  testResults: TestCaseResult[];
  aiScore?: number;
  aiReasoning?: string;
  aiSuggestions?: string;
}

interface OnlineGDBCompilerProps {
  // Optional contest integration props
  problem?: {
    id: string;
    title: string;
    difficulty: string;
    timeBudget: number;
    statement: string;
    starterCode?: Record<string, string>;
    testCases?: Array<{ id: string; input: string; expectedOutput: string; isHidden: boolean }>;
  } | null;
  draftCode?: string;
  draftLanguage?: string;
  onCodeChange?: (code: string, language: string) => void;
  onSubmitCode?: () => void;
  isSubmitting?: boolean;
  isJudging?: boolean;
  submissionResult?: SubmissionResultData | null;
  isLocked?: boolean;
  isPaused?: boolean;
}

export default function OnlineGDBCompiler({
  problem,
  draftCode,
  draftLanguage,
  onCodeChange,
  onSubmitCode,
  isSubmitting = false,
  isJudging = false,
  submissionResult = null,
  isLocked = false,
  isPaused = false,
}: OnlineGDBCompilerProps) {
  // State
  const [selectedLang, setSelectedLang] = useState<string>(draftLanguage || 'CPP');
  const [code, setCode] = useState<string>('');
  const [stdinText, setStdinText] = useState<string>('');
  
  // Editor Settings
  const [theme, setTheme] = useState<'vs-dark' | 'light' | 'hc-black'>('vs-dark');
  const [fontSize, setFontSize] = useState<number>(14);
  const [tabSize, setTabSize] = useState<number>(4);
  const [wordWrap, setWordWrap] = useState<'on' | 'off'>('on');
  const [showMinimap, setShowMinimap] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);

  // Layout & Resizing
  const [showLeftPanel, setShowLeftPanel] = useState<boolean>(!!problem);
  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(380); // px
  const [terminalHeight, setTerminalHeight] = useState<number>(240); // px
  const [activeTab, setActiveTab] = useState<'output' | 'stdin' | 'tests' | 'compile'>('output');
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isFullScreen, setIsFullScreen] = useState<boolean>(false);

  // Editor cursor status
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const editorRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Execution state
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [runResult, setRunResult] = useState<{
    stdout: string;
    stderr: string;
    compileError: string | null;
    runtimeMs: number;
    exitCode: number;
  } | null>(null);

  // Dragging refs
  const isDraggingH = useRef(false);
  const isDraggingV = useRef(false);

  const currentLangConfig = LANGUAGES.find((l) => l.id === selectedLang) || LANGUAGES[0];

  // Load starter code or draft code on mount/change
  useEffect(() => {
    if (draftCode) {
      setCode(draftCode);
      if (draftLanguage && LANGUAGES.some(l => l.id === draftLanguage)) {
        setSelectedLang(draftLanguage);
      }
    } else if (problem?.starterCode?.[selectedLang]) {
      setCode(problem.starterCode[selectedLang]);
    } else {
      const langObj = LANGUAGES.find(l => l.id === selectedLang);
      if (langObj) setCode(langObj.template);
    }
  }, [problem?.id, draftCode]);

  // When language dropdown changes
  const handleLanguageChange = (newLangId: string) => {
    setSelectedLang(newLangId);
    if (!draftCode) {
      if (problem?.starterCode?.[newLangId]) {
        const starter = problem.starterCode[newLangId];
        setCode(starter);
        onCodeChange?.(starter, newLangId);
      } else {
        const langObj = LANGUAGES.find((l) => l.id === newLangId);
        if (langObj) {
          setCode(langObj.template);
          onCodeChange?.(langObj.template, newLangId);
        }
      }
    } else {
      onCodeChange?.(code, newLangId);
    }
  };

  const handleEditorChange = (value: string | undefined) => {
    const val = value || '';
    setCode(val);
    onCodeChange?.(val, selectedLang);
  };

  // Run Code via Piston
  const handleRunCode = async () => {
    if (!code.trim() || isRunning) return;
    setIsRunning(true);
    setRunResult(null);
    setActiveTab('output');

    try {
      const res = await api.post('/submissions/run', {
        code,
        language: selectedLang,
        stdin: stdinText,
      });

      setRunResult(res.data);
      if (res.data.compileError) {
        setActiveTab('compile');
      }
    } catch (err: any) {
      const status = err.response?.status;
      const serverMsg = err.response?.data?.error;

      if (status === 429) {
        // Rate limited — show toast, don't pollute the output panel
        toast.error(serverMsg || 'Please wait before running again.');
      } else if (status === 503) {
        toast.error(serverMsg || 'Execution service is temporarily busy. Try again in a moment.');
      } else {
        const msg = serverMsg || 'Execution failed. Please try again.';
        setRunResult({ stdout: '', stderr: msg, compileError: null, runtimeMs: 0, exitCode: 1 });
        setActiveTab('output');
      }
    } finally {
      setIsRunning(false);
    }
  };

  // Format Code
  const handleFormatCode = () => {
    if (editorRef.current) {
      editorRef.current.getAction('editor.action.formatDocument')?.run();
      toast.success('Code formatted');
    }
  };

  // Download Code File
  const handleDownloadCode = () => {
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `main.${currentLangConfig.ext}`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded main.${currentLangConfig.ext}`);
  };

  // Upload Code File
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content !== undefined) {
        setCode(content);
        onCodeChange?.(content, selectedLang);
        toast.success(`Loaded ${file.name}`);
      }
    };
    reader.readAsText(file);
  };

  // Copy Code to Clipboard
  const handleCopyCode = () => {
    navigator.clipboard.writeText(code);
    setIsCopied(true);
    toast.success('Code copied to clipboard');
    setTimeout(() => setIsCopied(false), 2000);
  };

  // Toggle Full Screen Mode
  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullScreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      setIsFullScreen(false);
    }
  };

  // Switch to submission results automatically when submission arrives
  useEffect(() => {
    if (submissionResult) {
      setActiveTab('tests');
    }
  }, [submissionResult]);

  // Handle Dragging Splitters
  const handleMouseDownH = () => {
    isDraggingH.current = true;
    document.addEventListener('mousemove', handleMouseMoveH);
    document.addEventListener('mouseup', handleMouseUpH);
  };

  const handleMouseMoveH = (e: MouseEvent) => {
    if (!isDraggingH.current) return;
    const newW = Math.max(260, Math.min(e.clientX, window.innerWidth - 400));
    setLeftPanelWidth(newW);
  };

  const handleMouseUpH = () => {
    isDraggingH.current = false;
    document.removeEventListener('mousemove', handleMouseMoveH);
    document.removeEventListener('mouseup', handleMouseUpH);
  };

  const handleMouseDownV = () => {
    isDraggingV.current = true;
    document.addEventListener('mousemove', handleMouseMoveV);
    document.addEventListener('mouseup', handleMouseUpV);
  };

  const handleMouseMoveV = (e: MouseEvent) => {
    if (!isDraggingV.current) return;
    const containerH = window.innerHeight - 100;
    const newH = Math.max(100, Math.min(containerH - e.clientY + 50, containerH - 120));
    setTerminalHeight(newH);
  };

  const handleMouseUpV = () => {
    isDraggingV.current = false;
    document.removeEventListener('mousemove', handleMouseMoveV);
    document.removeEventListener('mouseup', handleMouseUpV);
  };

  // Keyboard Shortcuts (F9 -> Run, Ctrl+Enter -> Run, Ctrl+Shift+Enter -> Submit)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F9' || (e.ctrlKey && e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        handleRunCode();
      } else if (e.ctrlKey && e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        if (onSubmitCode && !isSubmitting && !isJudging) {
          onSubmitCode();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [code, selectedLang, stdinText, isSubmitting, isJudging]);

  return (
    <div className="h-full flex flex-col bg-surface-950 text-white overflow-hidden font-sans select-none">
      {/* ── Top OnlineGDB Header Toolbar ────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between px-3 py-1.5 bg-[#161b22] border-b border-white/10 gap-2 flex-shrink-0 z-10 shadow-lg">
        {/* Left section: Logo & Panel toggle */}
        <div className="flex items-center gap-2">
          {problem && (
            <button
              onClick={() => setShowLeftPanel(!showLeftPanel)}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-colors"
              title={showLeftPanel ? 'Hide Problem Panel' : 'Show Problem Panel'}
            >
              {showLeftPanel ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
            </button>
          )}

          <div className="flex items-center gap-2 pr-2 border-r border-white/10">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-md">
              <FileCode className="w-4 h-4 text-white" />
            </div>
            <span className="font-mono font-bold text-sm bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent hidden sm:inline">
              OnlineGDB Compiler
            </span>
          </div>

          {/* Language Selector Dropdown */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-white/40 font-mono hidden md:inline">Language:</label>
            <select
              value={selectedLang}
              onChange={(e) => handleLanguageChange(e.target.value)}
              className="bg-[#21262d] text-emerald-400 text-xs font-mono font-semibold px-2.5 py-1.5 rounded-md border border-white/15 focus:border-emerald-500 focus:outline-none cursor-pointer"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.id} value={lang.id} className="bg-[#161b22] text-white">
                  {lang.label} ({lang.ext})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Center section: Primary Execution Controls */}
        <div className="flex items-center gap-1.5">
          {/* Run Button */}
          <button
            onClick={handleRunCode}
            disabled={isRunning || !code.trim() || isLocked}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-bold font-mono transition-all
              bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white shadow-md
              border border-emerald-400/30 disabled:opacity-40"
            title="Run Code (F9 or Ctrl+Enter)"
          >
            {isRunning ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Compiling...
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                Run
                <span className="text-[10px] opacity-60 font-normal hidden lg:inline">(F9)</span>
              </>
            )}
          </button>

          {/* Submit / Debug Button (Contest mode) */}
          {onSubmitCode && (
            <button
              onClick={onSubmitCode}
              disabled={isSubmitting || isJudging || !code.trim() || isPaused || isLocked}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-bold font-mono transition-all
                bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white shadow-md
                border border-blue-400/30 disabled:opacity-40"
              title="Submit code for evaluation (Ctrl+Shift+Enter)"
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
          )}

          {/* Format / Beautify Code */}
          <button
            onClick={handleFormatCode}
            className="p-1.5 rounded-md bg-[#21262d] hover:bg-white/10 text-white/70 hover:text-white transition-colors border border-white/10"
            title="Beautify / Format Code"
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
          </button>

          {/* Clear Output */}
          <button
            onClick={() => setRunResult(null)}
            className="p-1.5 rounded-md bg-[#21262d] hover:bg-white/10 text-white/70 hover:text-red-400 transition-colors border border-white/10"
            title="Clear Console Output"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {/* Right section: File operations & Settings */}
        <div className="flex items-center gap-1.5">
          {/* File Operations */}
          <div className="hidden sm:flex items-center gap-1 border-r border-white/10 pr-2">
            <button
              onClick={handleDownloadCode}
              className="p-1.5 rounded-md bg-[#21262d] hover:bg-white/10 text-white/70 hover:text-white transition-colors border border-white/10"
              title="Download code file"
            >
              <Download className="w-4 h-4" />
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-1.5 rounded-md bg-[#21262d] hover:bg-white/10 text-white/70 hover:text-white transition-colors border border-white/10"
              title="Upload code file"
            >
              <Upload className="w-4 h-4" />
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              className="hidden"
              accept=".cpp,.c,.py,.java,.js,.ts,.cs,.go,.rs,.php,.txt"
            />

            <button
              onClick={handleCopyCode}
              className="p-1.5 rounded-md bg-[#21262d] hover:bg-white/10 text-white/70 hover:text-white transition-colors border border-white/10"
              title="Copy code to clipboard"
            >
              {isCopied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>

          {/* Settings Modal Toggle */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1.5 rounded-md transition-colors border border-white/10 ${
              showSettings ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-[#21262d] text-white/70 hover:text-white'
            }`}
            title="Editor Settings"
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* Full Screen */}
          <button
            onClick={toggleFullScreen}
            className="p-1.5 rounded-md bg-[#21262d] hover:bg-white/10 text-white/70 hover:text-white transition-colors border border-white/10 hidden md:block"
            title="Toggle Fullscreen Mode"
          >
            {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* ── Settings Drawer Modal ───────────────────────────────────────────── */}
      {showSettings && (
        <div className="bg-[#1c2128] border-b border-white/10 px-4 py-3 flex flex-wrap items-center gap-6 text-xs text-white/80 animate-fade-in shadow-xl z-20">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white/50 font-mono">Theme:</span>
            <select
              value={theme}
              onChange={(e: any) => setTheme(e.target.value)}
              className="bg-[#0d1117] text-white px-2 py-1 rounded border border-white/15"
            >
              <option value="vs-dark">VS Dark (Default)</option>
              <option value="light">Light Mode</option>
              <option value="hc-black">High Contrast</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-semibold text-white/50 font-mono">Font Size:</span>
            <select
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              className="bg-[#0d1117] text-white px-2 py-1 rounded border border-white/15"
            >
              <option value={12}>12px</option>
              <option value={14}>14px</option>
              <option value={16}>16px</option>
              <option value={18}>18px</option>
              <option value={20}>20px</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-semibold text-white/50 font-mono">Tab Size:</span>
            <select
              value={tabSize}
              onChange={(e) => setTabSize(Number(e.target.value))}
              className="bg-[#0d1117] text-white px-2 py-1 rounded border border-white/15"
            >
              <option value={2}>2 spaces</option>
              <option value={4}>4 spaces</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-semibold text-white/50 font-mono">Word Wrap:</span>
            <button
              onClick={() => setWordWrap(wordWrap === 'on' ? 'off' : 'on')}
              className={`px-2.5 py-1 rounded font-semibold border ${
                wordWrap === 'on' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-[#0d1117] text-white/50 border-white/10'
              }`}
            >
              {wordWrap.toUpperCase()}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-semibold text-white/50 font-mono">Minimap:</span>
            <button
              onClick={() => setShowMinimap(!showMinimap)}
              className={`px-2.5 py-1 rounded font-semibold border ${
                showMinimap ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-[#0d1117] text-white/50 border-white/10'
              }`}
            >
              {showMinimap ? 'SHOW' : 'HIDE'}
            </button>
          </div>

          <button
            onClick={() => setShowSettings(false)}
            className="ml-auto text-xs text-white/40 hover:text-white underline"
          >
            Close Settings
          </button>
        </div>
      )}

      {/* ── Main IDE Workspace: Split Panes ─────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left: Problem Statement Panel (if provided and toggled open) */}
        {problem && showLeftPanel && (
          <div
            className="flex flex-col bg-[#0d1117] border-r border-white/10 overflow-y-auto flex-shrink-0"
            style={{ width: leftPanelWidth }}
          >
            <div className="p-4 space-y-4">
              <div>
                <h2 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-emerald-400" />
                  {problem.title}
                </h2>
                <div className="flex items-center gap-2 text-white/40 text-xs mt-1">
                  <span className={`badge-${problem.difficulty.toLowerCase()}`}>
                    {problem.difficulty}
                  </span>
                  <span>• {problem.timeBudget} min budget</span>
                </div>
              </div>

              {/* Problem statement body */}
              <div className="prose prose-invert prose-sm max-w-none border-t border-white/10 pt-3">
                <div
                  className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap font-sans"
                  dangerouslySetInnerHTML={{ __html: problem.statement.replace(/\n/g, '<br/>') }}
                />
              </div>

              {/* Sample test cases */}
              {problem.testCases?.filter((tc) => !tc.isHidden).map((tc, idx) => (
                <div key={tc.id} className="bg-[#161b22] rounded-lg border border-white/10 overflow-hidden text-xs font-mono">
                  <div className="px-3 py-1.5 bg-[#21262d] font-semibold text-white/60 flex items-center justify-between">
                    <span>Example {idx + 1}</span>
                    <button
                      onClick={() => setStdinText(tc.input)}
                      className="text-[11px] text-emerald-400 hover:underline"
                      title="Set as STDIN input"
                    >
                      Use as Input
                    </button>
                  </div>
                  <div className="p-3 space-y-2">
                    <div>
                      <span className="text-white/40">Input:</span>
                      <pre className="text-white/80 mt-1 bg-[#0d1117] p-2 rounded border border-white/5 overflow-x-auto">{tc.input}</pre>
                    </div>
                    <div>
                      <span className="text-white/40">Output:</span>
                      <pre className="text-white/80 mt-1 bg-[#0d1117] p-2 rounded border border-white/5 overflow-x-auto">{tc.expectedOutput}</pre>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Horizontal Drag Handle */}
        {problem && showLeftPanel && (
          <div
            onMouseDown={handleMouseDownH}
            className="w-1.5 hover:w-2 bg-[#21262d] hover:bg-emerald-500 cursor-col-resize flex-shrink-0 transition-all z-10"
            title="Drag to resize problem panel"
          />
        )}

        {/* Right Area: Monaco Editor + Bottom Terminal */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#0d1117]">
          {/* Monaco Editor Container */}
          <div className="flex-1 relative overflow-hidden" style={{ minHeight: 120 }}>
            <Editor
              height="100%"
              language={currentLangConfig.monaco}
              value={code}
              onChange={handleEditorChange}
              onMount={(editor) => {
                editorRef.current = editor;
                editor.onDidChangeCursorPosition((e) => {
                  setCursorPos({ line: e.position.lineNumber, col: e.position.column });
                });
              }}
              theme={theme}
              options={{
                fontSize,
                tabSize,
                fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
                fontLigatures: true,
                minimap: { enabled: showMinimap },
                scrollBeyondLastLine: false,
                padding: { top: 12, bottom: 12 },
                lineNumbers: 'on',
                renderWhitespace: 'selection',
                cursorSmoothCaretAnimation: 'on',
                smoothScrolling: true,
                readOnly: isPaused || isLocked,
                wordWrap,
                automaticLayout: true,
              }}
            />
          </div>

          {/* Vertical Drag Handle */}
          <div
            onMouseDown={handleMouseDownV}
            className="h-1.5 hover:h-2 bg-[#21262d] hover:bg-emerald-500 cursor-row-resize flex-shrink-0 transition-all z-10"
            title="Drag to resize terminal panel"
          />

          {/* ── OnlineGDB Bottom Terminal Panel ──────────────────────────────── */}
          <div
            className="flex flex-col bg-[#0d1117] border-t border-white/10 flex-shrink-0 font-mono text-xs overflow-hidden"
            style={{ height: terminalHeight }}
          >
            {/* Terminal Header Tabs & Status Bar */}
            <div className="flex items-center justify-between px-3 py-1 bg-[#161b22] border-b border-white/10 flex-shrink-0">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setActiveTab('output')}
                  className={`px-3 py-1 rounded-t font-semibold transition-all flex items-center gap-1.5 ${
                    activeTab === 'output'
                      ? 'bg-[#0d1117] text-emerald-400 border-t-2 border-emerald-500'
                      : 'text-white/50 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Terminal className="w-3.5 h-3.5" />
                  Console Output
                  {runResult && (
                    <span className={`w-2 h-2 rounded-full ${runResult.exitCode === 0 ? 'bg-emerald-400' : 'bg-red-400'}`} />
                  )}
                </button>

                <button
                  onClick={() => setActiveTab('stdin')}
                  className={`px-3 py-1 rounded-t font-semibold transition-all flex items-center gap-1.5 ${
                    activeTab === 'stdin'
                      ? 'bg-[#0d1117] text-emerald-400 border-t-2 border-emerald-500'
                      : 'text-white/50 hover:text-white hover:bg-white/5'
                  }`}
                >
                  Standard Input (STDIN)
                  {stdinText.trim() && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
                </button>

                {submissionResult && (
                  <button
                    onClick={() => setActiveTab('tests')}
                    className={`px-3 py-1 rounded-t font-semibold transition-all flex items-center gap-1.5 ${
                      activeTab === 'tests'
                        ? 'bg-[#0d1117] text-emerald-400 border-t-2 border-emerald-500'
                        : 'text-white/50 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    Test Results
                    <span className={`px-1.5 py-0.2 text-[10px] rounded ${
                      submissionResult.passRatio === 1 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                      {Math.round(submissionResult.passRatio * 100)}%
                    </span>
                  </button>
                )}

                {runResult?.compileError && (
                  <button
                    onClick={() => setActiveTab('compile')}
                    className={`px-3 py-1 rounded-t font-semibold transition-all flex items-center gap-1.5 ${
                      activeTab === 'compile'
                        ? 'bg-[#0d1117] text-red-400 border-t-2 border-red-500'
                        : 'text-red-400/60 hover:text-red-400 hover:bg-white/5'
                    }`}
                  >
                    <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                    Compile Error
                  </button>
                )}
              </div>

              {/* Execution details & Cursor Status */}
              <div className="flex items-center gap-3 text-[11px] text-white/40">
                {runResult && (
                  <span className="font-mono">
                    Exit: <span className={runResult.exitCode === 0 ? 'text-emerald-400' : 'text-red-400'}>{runResult.exitCode}</span> • Runtime: {runResult.runtimeMs}ms
                  </span>
                )}
                <span className="hidden sm:inline">
                  Ln {cursorPos.line}, Col {cursorPos.col} | {code.length} chars
                </span>
              </div>
            </div>

            {/* Terminal Body Content */}
            <div className="flex-1 bg-[#0d1117] p-3 overflow-auto font-mono text-xs">
              {/* Output Tab */}
              {activeTab === 'output' && (
                <div className="space-y-2">
                  {!runResult && !isRunning && (
                    <div className="text-white/30 space-y-1">
                      <p className="text-emerald-500/80">OnlineGDB Interactive Console Shell v2.4</p>
                      <p>Type your code and press <span className="text-emerald-400 font-bold">Run (F9)</span> to execute.</p>
                    </div>
                  )}

                  {isRunning && (
                    <div className="flex items-center gap-2 text-emerald-400 font-semibold animate-pulse">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Compiling and executing code...
                    </div>
                  )}

                  {runResult && !isRunning && (
                    <div className="space-y-2">
                      {/* Terminal Command Simulation Header */}
                      <div className="text-white/40 border-b border-white/5 pb-1 text-[11px]">
                        $ g++ main.{currentLangConfig.ext} -o main && ./main
                      </div>

                      {runResult.compileError && (
                        <div className="bg-red-950/30 border border-red-500/20 p-2.5 rounded text-red-400 whitespace-pre-wrap break-words">
                          <span className="font-bold text-red-300">[Compilation Error]</span>
                          {'\n'}{runResult.compileError}
                        </div>
                      )}

                      {runResult.stdout && (
                        <pre className="text-emerald-300 font-mono whitespace-pre-wrap break-words leading-relaxed">
                          {runResult.stdout}
                        </pre>
                      )}

                      {runResult.stderr && (
                        <div className="text-red-400/90 font-mono whitespace-pre-wrap break-words mt-2 border-t border-red-500/10 pt-1">
                          <span className="text-red-500 font-bold">[stderr]:</span>
                          {'\n'}{runResult.stderr}
                        </div>
                      )}

                      {!runResult.compileError && !runResult.stdout && !runResult.stderr && (
                        <p className="text-white/30">(Program completed with no output)</p>
                      )}

                      {/* Exit Status Footer */}
                      <div className="pt-2 border-t border-white/5 flex items-center gap-2 text-[11px]">
                        <span className={`px-2 py-0.5 rounded font-bold ${
                          runResult.exitCode === 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                          Process finished with exit code {runResult.exitCode}
                        </span>
                        <span className="text-white/40">• Execution time: {(runResult.runtimeMs / 1000).toFixed(3)}s</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* STDIN Tab */}
              {activeTab === 'stdin' && (
                <div className="h-full flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-white/50 text-[11px]">
                      Enter inputs below (separated by newlines) to pass into standard input:
                    </span>
                    <button
                      onClick={() => setStdinText('')}
                      className="text-[11px] text-white/40 hover:text-red-400"
                    >
                      Clear STDIN
                    </button>
                  </div>
                  <textarea
                    value={stdinText}
                    onChange={(e) => setStdinText(e.target.value)}
                    placeholder={`Enter STDIN input...\nExample:\n5\n1 2 3 4 5`}
                    className="flex-1 bg-[#161b22] text-emerald-300 font-mono text-xs p-3 rounded border border-white/10 outline-none focus:border-emerald-500 resize-none"
                    spellCheck={false}
                  />
                </div>
              )}

              {/* Test Results Tab (Contest Mode) */}
              {activeTab === 'tests' && submissionResult && (
                <div className="space-y-3">
                  <div className={`p-3 rounded-lg flex items-center justify-between font-sans ${
                    submissionResult.passRatio === 1 ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-red-500/10 border border-red-500/30'
                  }`}>
                    <div className="flex items-center gap-2">
                      {submissionResult.passRatio === 1 ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-400" />
                      )}
                      <div>
                        <div className="font-bold text-sm text-white">
                          {submissionResult.status.replace('_', ' ')}
                        </div>
                        <div className="text-xs text-white/60">
                          {Math.round(submissionResult.passRatio * 100)}% tests passed • Earned +{submissionResult.apAwarded.toFixed(0)} AP
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Individual Test Cases */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {submissionResult.testResults.map((tc, idx) => (
                      <div
                        key={tc.testCaseId}
                        className={`p-2.5 rounded border text-xs ${
                          tc.passed ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className={`font-semibold ${tc.passed ? 'text-emerald-400' : 'text-red-400'}`}>
                            {tc.isHidden ? `Hidden Test ${idx + 1}` : `Test Case ${idx + 1}`}
                          </span>
                          <span className="text-white/40 text-[11px]">{tc.runtimeMs}ms</span>
                        </div>
                        {!tc.passed && !tc.isHidden && tc.actualOutput && (
                          <div className="text-[11px] text-white/70 mt-1">
                            <div>Expected: <code className="text-emerald-400">{tc.expectedOutput}</code></div>
                            <div>Actual Output: <code className="text-red-400">{tc.actualOutput}</code></div>
                          </div>
                        )}
                        {tc.errorMessage && (
                          <div className="text-[11px] text-red-400 mt-1">{tc.errorMessage}</div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* AI Code Review */}
                  {submissionResult.aiScore !== undefined && (
                    <div className="bg-[#161b22] p-3 rounded-lg border border-white/10 space-y-1 font-sans">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs text-emerald-400 flex items-center gap-1.5">
                          <Cpu className="w-4 h-4" /> AI Logic & Efficiency Analysis
                        </span>
                        <div className="flex gap-0.5">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <Star
                              key={s}
                              className={`w-3 h-3 ${
                                s <= Math.round(submissionResult.aiScore! * 5)
                                  ? 'text-amber-400 fill-amber-400'
                                  : 'text-white/20'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                      <p className="text-white/70 text-xs">{submissionResult.aiReasoning}</p>
                      {submissionResult.aiSuggestions && (
                        <p className="text-emerald-400/80 text-xs">💡 Suggestion: {submissionResult.aiSuggestions}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Compile Tab */}
              {activeTab === 'compile' && runResult?.compileError && (
                <div className="space-y-2">
                  <div className="text-red-400 font-bold flex items-center gap-2 border-b border-red-500/20 pb-1">
                    <AlertCircle className="w-4 h-4" />
                    Compiler Diagnostic Output
                  </div>
                  <pre className="text-red-400 bg-red-950/20 p-3 rounded border border-red-500/20 whitespace-pre-wrap font-mono leading-relaxed">
                    {runResult.compileError}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
