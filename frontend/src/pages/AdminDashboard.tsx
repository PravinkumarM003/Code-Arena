import { useEffect, useState, useCallback } from 'react';
import {
  Play, Pause, Square, Clock, Plus, Minus, Megaphone,
  Users, Trophy, AlertTriangle, Activity, Download,
  RefreshCw, CheckCircle, XCircle, Shield, Settings,
  ChevronUp, ChevronDown, Loader2, BookOpen, Trash2, Edit3, Cpu
} from 'lucide-react';
import api from '../lib/api';
import { useContest } from '../contexts/ContestContext';
import toast from 'react-hot-toast';

type ContestState = 'WAITING' | 'RUNNING' | 'PAUSED' | 'ENDED';

interface MonitorUser {
  userId: string;
  name: string;
  rollNumber: string;
  ap: number;
  rank: number;
  problemsSolved: number;
  currentProblemTitle?: string;
  isDisqualified?: boolean;
}

interface InfraStats {
  activeConnections: number;
  avgPistonMs: number;
  updatedAt: number;
}

interface Problem {
  id: string;
  title: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  isActive: boolean;
  testCases: Array<{ id: string; input: string; expectedOutput: string; isHidden: boolean; points: number }>;
}

type Tab = 'control' | 'monitor' | 'problems' | 'incidents';

export default function AdminDashboard() {
  const { socket } = useContest();
  const [contestState, setContestState] = useState<ContestState>('WAITING');
  const [remainingMs, setRemainingMs] = useState(0);
  const [users, setUsers] = useState<MonitorUser[]>([]);
  const [infra, setInfra] = useState<{ queue: { waiting: number; active: number; failed: number }; redis: { memory: string }; infra: InfraStats; process: { memoryMB: number; uptime: number } } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [extendMinutes, setExtendMinutes] = useState(10);
  const [activeTab, setActiveTab] = useState<Tab>('control');
  const [problems, setProblems] = useState<Problem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<'rank' | 'ap' | 'name'>('rank');
  const [incidents, setIncidents] = useState<Array<{ uid: string; name: string; eventType: string; count: number; timestamp: number }>>([]);
  const [resetEventName, setResetEventName] = useState('');
  const [showResetPanel, setShowResetPanel] = useState(false);
  const [contestMode, setContestModeState] = useState<'INDIVIDUAL' | 'GROUP'>('INDIVIDUAL');

  // New problem form
  const [showProblemForm, setShowProblemForm] = useState(false);
  const [problemForm, setProblemForm] = useState({
    title: '', statement: '', difficulty: 'EASY' as const,
    timeBudget: 30, baseAp: 100,
    starterCode: { PYTHON: '', JAVA: '', CPP: '', JAVASCRIPT: '' },
    testCases: [{ input: '', expectedOutput: '', isHidden: false, points: 1 }],
    isActive: true,
  });

  const fetchMonitor = useCallback(async () => {
    try {
      const [monitorRes, healthRes] = await Promise.all([
        api.get('/admin/monitor'),
        api.get('/admin/health-detail'),
      ]);
      setUsers(monitorRes.data.users || []);
      setContestState(monitorRes.data.contestState);
      setRemainingMs(monitorRes.data.remainingMs);
      setInfra(healthRes.data);
    } catch (err) {
      console.error('Monitor fetch error', err);
    }
  }, []);

  const fetchProblems = useCallback(async () => {
    try {
      const res = await api.get('/problems');
      setProblems(res.data.problems || []);
    } catch (err) {
      console.error('Problems fetch error', err);
    }
  }, []);

  useEffect(() => {
    fetchMonitor();
    fetchProblems();
    // Fetch current mode
    api.get('/admin/mode').then(res => setContestModeState(res.data.mode)).catch(() => {});
    const interval = setInterval(fetchMonitor, 3000); // poll every 3s — also syncs remainingMs
    return () => clearInterval(interval);
  }, [fetchMonitor, fetchProblems]);

  // Listen for real-time anti-cheat incidents via socket
  useEffect(() => {
    if (!socket) return;
    const handleIncident = (data: { uid: string; name: string; eventType: string; count: number; timestamp: number }) => {
      setIncidents((prev) => {
        // Upsert: update count if same user+eventType already logged, else prepend
        const existing = prev.findIndex((i) => i.uid === data.uid && i.eventType === data.eventType);
        if (existing !== -1) {
          const updated = [...prev];
          updated[existing] = data;
          return updated;
        }
        return [data, ...prev];
      });
    };
    socket.on('admin:incident', handleIncident);
    return () => { socket.off('admin:incident', handleIncident); };
  }, [socket]);

  function formatTime(ms: number) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  // ── Contest Controls ────────────────────────────────────────────────────────

  const handleStart = async () => {
    if (!confirm(`Start the contest in ${contestMode} mode for all connected participants?`)) return;
    setLoading(true);
    try {
      const res = await api.post('/admin/start', { mode: contestMode });
      setContestState('RUNNING');
      toast.success(`Contest started for ${res.data.usersCount} users (${contestMode} mode)!`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to start');
    } finally {
      setLoading(false);
    }
  };

  const handlePause = async () => {
    setLoading(true);
    try {
      await api.post('/admin/pause');
      setContestState('PAUSED');
      toast('Contest paused', { icon: '⏸' });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to pause');
    } finally {
      setLoading(false);
    }
  };

  const handleResume = async () => {
    setLoading(true);
    try {
      await api.post('/admin/resume');
      setContestState('RUNNING');
      toast.success('Contest resumed!');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to resume');
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    if (!confirm('STOP the contest? This cannot be undone.')) return;
    setLoading(true);
    try {
      await api.post('/admin/stop');
      setContestState('ENDED');
      toast('Contest ended', { icon: '🏁' });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to stop');
    } finally {
      setLoading(false);
    }
  };

  const handleExtend = async () => {
    try {
      await api.post('/admin/extend', { minutes: extendMinutes });
      toast.success(`Contest extended by ${extendMinutes} minutes!`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to extend');
    }
  };

  const handleSoftReset = async () => {
    if (!confirm('Soft Reset: restart the timer but keep all current scores and progress?')) return;
    setLoading(true);
    try {
      const res = await api.post('/admin/reset/soft');
      setContestState('RUNNING');
      setShowResetPanel(false);
      toast.success(`Timer restarted! Same event continues.`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Soft reset failed');
    } finally {
      setLoading(false);
    }
  };

  const handleHardReset = async () => {
    if (!confirm('Hard Reset: create a BRAND NEW event? All scores and problem progress will reset to 0. This cannot be undone.')) return;
    setLoading(true);
    try {
      const res = await api.post('/admin/reset/hard', {
        name: resetEventName.trim() || undefined,
      });
      setContestState('RUNNING');
      setShowResetPanel(false);
      setResetEventName('');
      toast.success(`New event "${res.data.eventId}" started for ${res.data.usersCount} users!`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Hard reset failed');
    } finally {
      setLoading(false);
    }
  };

  const handleAnnounce = async () => {
    if (!announcement.trim()) return;
    try {
      await api.post('/admin/announce', { message: announcement });
      toast.success('Announcement sent!');
      setAnnouncement('');
    } catch (err: any) {
      toast.error('Failed to send announcement');
    }
  };

  const handleDeleteAnnouncement = async () => {
    try {
      await api.delete('/admin/announce');
      toast.success('Announcement deleted');
      setAnnouncement('');
    } catch {
      toast.error('Failed to delete announcement');
    }
  };

  const handleDisqualify = async (userId: string, name: string) => {
    const reason = prompt(`Reason for disqualifying ${name}?`);
    if (!reason) return;
    try {
      await api.post('/admin/override', { targetUserId: userId, action: 'DISQUALIFY', reason });
      toast.success(`${name} disqualified`);
      fetchMonitor();
    } catch {
      toast.error('Failed to disqualify');
    }
  };

  const handleUnlock = async (userId: string, name: string) => {
    try {
      await api.post('/admin/override', { targetUserId: userId, action: 'REINSTATE', reason: 'Admin unlock' });
      toast.success(`${name} unlocked`);
      fetchMonitor();
    } catch {
      toast.error('Failed to unlock');
    }
  };

  const handleAdjustAP = async (userId: string, name: string) => {
    const deltaStr = prompt(`AP adjustment for ${name} (positive or negative):`);
    if (!deltaStr) return;
    const delta = parseFloat(deltaStr);
    if (isNaN(delta)) { toast.error('Invalid number'); return; }
    const reason = prompt('Reason for adjustment?') || '';
    try {
      await api.post('/admin/override', { targetUserId: userId, action: 'ADJUST_AP', apDelta: delta, reason });
      toast.success(`AP adjusted for ${name}`);
      fetchMonitor();
    } catch {
      toast.error('Failed to adjust AP');
    }
  };

  // ── Problem CRUD ────────────────────────────────────────────────────────────

  const handleCreateProblem = async () => {
    try {
      await api.post('/problems', problemForm);
      toast.success('Problem created!');
      setShowProblemForm(false);
      fetchProblems();
      setProblemForm({
        title: '', statement: '', difficulty: 'EASY', timeBudget: 30, baseAp: 100,
        starterCode: { PYTHON: '', JAVA: '', CPP: '', JAVASCRIPT: '' },
        testCases: [{ input: '', expectedOutput: '', isHidden: false, points: 1 }],
        isActive: true,
      });
    } catch {
      toast.error('Failed to create problem');
    }
  };

  const handleDeleteProblem = async (id: string) => {
    if (!confirm('Deactivate this problem?')) return;
    try {
      await api.delete(`/problems/${id}`);
      toast.success('Problem deactivated');
      fetchProblems();
    } catch {
      toast.error('Failed to delete problem');
    }
  };

  const handleExportCSV = async () => {
    try {
      const res = await api.get('/admin/export', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'contest_results.csv';
      a.click();
    } catch {
      toast.error('Failed to export');
    }
  };

  const handleRunSimilarity = async () => {
    try {
      const res = await api.post('/results/run-similarity');
      toast.success(`Similarity scan complete! ${res.data.flagCount} pairs flagged.`);
    } catch {
      toast.error('Similarity scan failed');
    }
  };

  const sortedUsers = [...users].sort((a, b) => {
    if (sortBy === 'rank') return a.rank - b.rank;
    if (sortBy === 'ap') return b.ap - a.ap;
    return a.name.localeCompare(b.name);
  });

  const stateColor = {
    WAITING: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    RUNNING: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    PAUSED: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    ENDED: 'text-red-400 bg-red-500/10 border-red-500/20',
  };

  const stateIcon = {
    WAITING: <Clock className="w-4 h-4" />,
    RUNNING: <Activity className="w-4 h-4 animate-pulse" />,
    PAUSED: <Pause className="w-4 h-4" />,
    ENDED: <Square className="w-4 h-4" />,
  };

  return (
    <div className="min-h-screen bg-surface-950 text-white">
      {/* Admin Header */}
      <header className="sticky top-0 z-40 bg-surface-900/90 backdrop-blur-sm border-b border-white/5 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-brand-400" />
              <span className="font-bold text-white">Admin Dashboard</span>
            </div>

            {/* State badge */}
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border ${stateColor[contestState]}`}>
              {stateIcon[contestState]}
              {contestState}
              {contestState === 'RUNNING' && (
                <span className="font-mono">{formatTime(remainingMs)}</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-white/30 text-sm">{users.length} participants</span>
            <button onClick={fetchMonitor} className="btn-secondary text-xs py-1.5 px-3">
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="flex border-b border-white/5 px-6">
        {(['control', 'monitor', 'problems', 'incidents'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-3 text-sm font-medium capitalize border-b-2 transition-colors
              ${activeTab === tab
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-white/40 hover:text-white/70'}`}
          >
            {tab === 'monitor' ? '👁 Monitor' :
             tab === 'control' ? '🎛 Controls' :
             tab === 'problems' ? '📚 Problems' : '🚨 Incidents'}
          </button>
        ))}
      </div>

      <div className="p-6 max-w-7xl mx-auto">
        {/* ── CONTROLS TAB ─────────────────────────────────────────────────────── */}
        {activeTab === 'control' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Contest Control */}
            <div className="glass-card p-6">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Settings className="w-5 h-5 text-brand-400" />
                Contest Control
              </h3>

              {/* Mode Toggle */}
              {contestState === 'WAITING' && (
                <div className="mb-4 flex items-center gap-3 bg-white/5 rounded-xl p-3">
                  <span className="text-white/60 text-sm font-medium">Mode:</span>
                  <div className="flex bg-white/5 rounded-lg p-0.5">
                    <button
                      onClick={() => {
                        setContestModeState('INDIVIDUAL');
                        api.put('/admin/mode', { mode: 'INDIVIDUAL' }).catch(() => {});
                      }}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                        contestMode === 'INDIVIDUAL'
                          ? 'bg-brand-600 text-white shadow-sm'
                          : 'text-white/40 hover:text-white/70'
                      }`}
                    >
                      Individual
                    </button>
                    <button
                      onClick={() => {
                        setContestModeState('GROUP');
                        api.put('/admin/mode', { mode: 'GROUP' }).catch(() => {});
                      }}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                        contestMode === 'GROUP'
                          ? 'bg-purple-600 text-white shadow-sm'
                          : 'text-white/40 hover:text-white/70'
                      }`}
                    >
                      Group (Teams)
                    </button>
                  </div>
                  {contestMode === 'GROUP' && (
                    <span className="text-purple-400 text-xs font-medium ml-auto">
                      Teams of 4
                    </span>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 mb-4">
                <button
                  onClick={handleStart}
                  disabled={loading || contestState !== 'WAITING'}
                  className="btn-primary justify-center py-3 disabled:opacity-40"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  Start
                </button>
                <button
                  onClick={contestState === 'PAUSED' ? handleResume : handlePause}
                  disabled={loading || contestState === 'WAITING' || contestState === 'ENDED'}
                  className="btn-secondary justify-center py-3 disabled:opacity-40"
                >
                  {contestState === 'PAUSED' ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                  {contestState === 'PAUSED' ? 'Resume' : 'Pause'}
                </button>
              </div>
              <button
                onClick={handleStop}
                disabled={loading || contestState === 'WAITING' || contestState === 'ENDED'}
                className="btn-danger w-full justify-center py-3 disabled:opacity-40"
              >
                <Square className="w-4 h-4" />
                Stop Contest
              </button>

              {/* New Event panel — shown when contest ENDED */}
              {contestState === 'ENDED' && (
                <div className="mt-4 border-t border-white/10 pt-4">
                  <button
                    id="admin-new-event-toggle"
                    onClick={() => setShowResetPanel((v) => !v)}
                    className="btn-secondary w-full justify-center py-2.5 text-sm"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Start New Event / Repeat
                  </button>

                  {showResetPanel && (
                    <div className="mt-3 space-y-3 animate-fade-in">
                      <input
                        id="admin-event-name"
                        type="text"
                        value={resetEventName}
                        onChange={(e) => setResetEventName(e.target.value)}
                        placeholder="Event name (optional, e.g. Round 2)"
                        className="input w-full text-sm"
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          id="admin-soft-reset"
                          onClick={handleSoftReset}
                          disabled={loading}
                          className="btn-secondary justify-center py-2.5 text-sm disabled:opacity-40"
                          title="Restart timer only. All scores are kept."
                        >
                          <RefreshCw className="w-4 h-4" />
                          Soft Reset
                          <span className="text-xs text-white/40 block leading-none">Keep scores</span>
                        </button>
                        <button
                          id="admin-hard-reset"
                          onClick={handleHardReset}
                          disabled={loading}
                          className="bg-red-600 hover:bg-red-500 text-white font-semibold rounded-xl flex flex-col items-center justify-center gap-0.5 py-2.5 px-3 transition-all disabled:opacity-40"
                          title="New event: all scores and problem progress reset to 0."
                        >
                          <div className="flex items-center gap-1.5">
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                            Hard Reset
                          </div>
                          <span className="text-xs text-red-200/60">Fresh scores</span>
                        </button>
                      </div>
                      <p className="text-white/30 text-xs text-center">
                        Soft = same event, timer restarts · Hard = brand new event, everyone starts at 0
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Extend Time */}
            <div className="glass-card p-6">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5 text-brand-400" />
                Extend Time
              </h3>
              <div className="flex items-center gap-3 mb-3">
                <button onClick={() => setExtendMinutes(Math.max(1, extendMinutes - 5))} className="btn-secondary p-2">
                  <Minus className="w-4 h-4" />
                </button>
                <span className="text-3xl font-black text-white text-center w-16">{extendMinutes}</span>
                <button onClick={() => setExtendMinutes(Math.min(60, extendMinutes + 5))} className="btn-secondary p-2">
                  <Plus className="w-4 h-4" />
                </button>
                <span className="text-white/50">minutes</span>
              </div>
              <button onClick={handleExtend} disabled={contestState !== 'RUNNING' && contestState !== 'PAUSED'} className="btn-primary w-full justify-center disabled:opacity-40">
                Extend Contest Time
              </button>
            </div>

            {/* Announcement */}
            <div className="glass-card p-6">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Megaphone className="w-5 h-5 text-brand-400" />
                Announcement
              </h3>
              <textarea
                value={announcement}
                onChange={(e) => setAnnouncement(e.target.value)}
                placeholder="Type an announcement to broadcast to all students..."
                className="input h-24 resize-none mb-3"
              />
              <div className="flex gap-2">
                <button onClick={handleAnnounce} disabled={!announcement.trim()} className="btn-primary w-full justify-center disabled:opacity-40">
                  <Megaphone className="w-4 h-4" />
                  Broadcast
                </button>
                <button onClick={handleDeleteAnnouncement} className="btn-secondary px-3 text-red-400 hover:text-red-300 border-red-500/20 hover:bg-red-500/10">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Infra Health */}
            <div className="glass-card p-6">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5 text-brand-400" />
                Infrastructure Health
              </h3>
              {infra ? (
                <div className="space-y-3">
                  {[
                    { label: 'Active Connections', value: infra.infra?.activeConnections || 0, icon: <Users className="w-4 h-4" />, warn: (infra.infra?.activeConnections || 0) > 450 },
                    { label: 'Queue Depth', value: `${infra.queue.waiting}W / ${infra.queue.active}A`, icon: <Activity className="w-4 h-4" />, warn: infra.queue.waiting > 50 },
                    { label: 'Failed Jobs', value: infra.queue.failed, icon: <XCircle className="w-4 h-4" />, warn: infra.queue.failed > 5 },
                    { label: 'Avg Piston Response', value: `${infra.infra?.avgPistonMs || 0}ms`, icon: <Loader2 className="w-4 h-4" />, warn: (infra.infra?.avgPistonMs || 0) > 8000 },
                    { label: 'Server Memory', value: `${infra.process.memoryMB}MB`, icon: <Cpu className="w-4 h-4" />, warn: infra.process.memoryMB > 400 },
                    { label: 'Redis Memory', value: infra.redis.memory, icon: <Activity className="w-4 h-4" />, warn: false },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
                      <div className={`flex items-center gap-2 text-sm ${item.warn ? 'text-red-400' : 'text-white/50'}`}>
                        {item.icon}
                        {item.label}
                        {item.warn && <AlertTriangle className="w-3.5 h-3.5" />}
                      </div>
                      <span className={`font-mono text-sm font-semibold ${item.warn ? 'text-red-400' : 'text-white'}`}>
                        {String(item.value)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center py-8 text-white/30">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  Loading...
                </div>
              )}
            </div>

            {/* Post-Contest Actions */}
            <div className="glass-card p-6 lg:col-span-2">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Download className="w-5 h-5 text-brand-400" />
                Post-Contest Actions
              </h3>
              <div className="flex gap-3 flex-wrap">
                <button onClick={handleExportCSV} className="btn-secondary">
                  <Download className="w-4 h-4" />
                  Export Results CSV
                </button>
                <button onClick={handleRunSimilarity} className="btn-secondary">
                  <Shield className="w-4 h-4" />
                  Run Plagiarism Scan
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── MONITOR TAB ──────────────────────────────────────────────────────── */}
        {activeTab === 'monitor' && (
          <div>
            {/* Sort controls */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-white/40 text-sm">Sort by:</span>
              {(['rank', 'ap', 'name'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSortBy(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
                    ${sortBy === s ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30' : 'bg-white/5 text-white/40 hover:text-white/70'}`}
                >
                  {s === 'rank' ? '🏆 Rank' : s === 'ap' ? '⚡ AP' : '🔤 Name'}
                </button>
              ))}
              <span className="ml-auto text-white/30 text-sm">{users.length} participants</span>
            </div>

            <div className="glass-card overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-white/30">Rank</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-white/30">Name</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-white/30">Roll No.</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-white/30">Current Problem</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-white/30">Solved</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-white/30">AP</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-white/30">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedUsers.map((u) => (
                    <tr key={u.userId} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                      <td className="px-4 py-3">
                        <span className={u.rank <= 3 ? `rank-${u.rank}` : 'text-white/50 font-medium'}>
                          #{u.rank}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-white">{u.name}</td>
                      <td className="px-4 py-3 text-white/50 text-sm font-mono">{u.rollNumber}</td>
                      <td className="px-4 py-3 text-white/60 text-sm truncate max-w-40">
                        {u.currentProblemTitle || '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-white font-semibold">{u.problemsSolved}</td>
                      <td className="px-4 py-3 text-right">
                        <span className="ap-glow">{u.ap.toFixed(0)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleAdjustAP(u.userId, u.name)}
                            title="Adjust AP"
                            className="p-1.5 rounded-lg text-white/30 hover:text-brand-400 hover:bg-brand-500/10 transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          {u.isDisqualified ? (
                            <button
                              onClick={() => handleUnlock(u.userId, u.name)}
                              title="Unlock Account"
                              className="p-1.5 rounded-lg text-white/30 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                            >
                              <Shield className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleDisqualify(u.userId, u.name)}
                              title="Disqualify"
                              className="p-1.5 rounded-lg text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sortedUsers.length === 0 && (
                <div className="py-12 text-center text-white/30">
                  <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No participants yet</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── PROBLEMS TAB ─────────────────────────────────────────────────────── */}
        {activeTab === 'problems' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-white/50 text-sm">{problems.filter(p => p.isActive).length} active problems</span>
              <button onClick={() => setShowProblemForm(!showProblemForm)} className="btn-primary">
                <BookOpen className="w-4 h-4" />
                {showProblemForm ? 'Cancel' : 'Add Problem'}
              </button>
            </div>

            {/* Problem creation form */}
            {showProblemForm && (
              <div className="glass-card p-6 mb-6 animate-slide-up">
                <h3 className="text-lg font-bold text-white mb-4">New Problem</h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-white/40 mb-1">Title</label>
                      <input className="input" value={problemForm.title} onChange={(e) => setProblemForm(p => ({ ...p, title: e.target.value }))} placeholder="Problem title" />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs text-white/40 mb-1">Difficulty</label>
                        <select className="input" value={problemForm.difficulty} onChange={(e) => setProblemForm(p => ({ ...p, difficulty: e.target.value as any }))}>
                          <option value="EASY">Easy</option>
                          <option value="MEDIUM">Medium</option>
                          <option value="HARD">Hard</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-white/40 mb-1">Time Budget (min)</label>
                        <input type="number" className="input" value={problemForm.timeBudget} onChange={(e) => setProblemForm(p => ({ ...p, timeBudget: parseInt(e.target.value) }))} />
                      </div>
                      <div>
                        <label className="block text-xs text-white/40 mb-1">Base AP</label>
                        <input type="number" className="input" value={problemForm.baseAp} onChange={(e) => setProblemForm(p => ({ ...p, baseAp: parseInt(e.target.value) }))} />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-white/40 mb-1">Problem Statement</label>
                    <textarea className="input h-32 resize-none font-mono text-sm" value={problemForm.statement} onChange={(e) => setProblemForm(p => ({ ...p, statement: e.target.value }))} placeholder="Problem description, constraints, examples..." />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs text-white/40">Test Cases</label>
                      <span className="text-xs text-white/25">Input supports multiple lines · Output can also be multi-line</span>
                    </div>
                    {problemForm.testCases.map((tc, idx) => (
                      <div key={idx} className="mb-3 p-3 bg-white/5 rounded-xl border border-white/5">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-white/40">
                            {tc.isHidden ? '🔒 Hidden' : '👁 Visible'} Test Case {idx + 1}
                          </span>
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-1.5 text-xs text-white/40 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={tc.isHidden}
                                onChange={(e) => {
                                  const tcs = [...problemForm.testCases];
                                  tcs[idx] = { ...tcs[idx], isHidden: e.target.checked };
                                  setProblemForm(p => ({ ...p, testCases: tcs }));
                                }}
                                className="accent-brand-500"
                              />
                              Hidden
                            </label>
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-white/30">pts:</span>
                              <input
                                type="number"
                                min={0.1} step={0.5}
                                value={tc.points}
                                onChange={(e) => {
                                  const tcs = [...problemForm.testCases];
                                  tcs[idx] = { ...tcs[idx], points: parseFloat(e.target.value) || 1 };
                                  setProblemForm(p => ({ ...p, testCases: tcs }));
                                }}
                                className="input py-0.5 px-2 w-16 text-xs text-center"
                              />
                            </div>
                            {problemForm.testCases.length > 1 && (
                              <button
                                onClick={() => {
                                  setProblemForm(p => ({
                                    ...p,
                                    testCases: p.testCases.filter((_, i) => i !== idx),
                                  }));
                                }}
                                className="text-red-400/60 hover:text-red-400 transition-colors text-xs px-1"
                                title="Remove this test case"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-white/30 mb-1">
                              Input <span className="text-white/15">(multi-line ok)</span>
                            </label>
                            <textarea
                              className="input h-28 text-xs font-mono resize-y min-h-16"
                              value={tc.input}
                              placeholder={`e.g.\n5\n3 1 4 1 5`}
                              onChange={(e) => {
                                const tcs = [...problemForm.testCases];
                                tcs[idx] = { ...tcs[idx], input: e.target.value };
                                setProblemForm(p => ({ ...p, testCases: tcs }));
                              }}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-white/30 mb-1">
                              Expected Output <span className="text-white/15">(multi-line ok)</span>
                            </label>
                            <textarea
                              className="input h-28 text-xs font-mono resize-y min-h-16"
                              value={tc.expectedOutput}
                              placeholder={`e.g.\n1 1 3 4 5`}
                              onChange={(e) => {
                                const tcs = [...problemForm.testCases];
                                tcs[idx] = { ...tcs[idx], expectedOutput: e.target.value };
                                setProblemForm(p => ({ ...p, testCases: tcs }));
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                    <button
                      onClick={() => setProblemForm(p => ({
                        ...p,
                        testCases: [...p.testCases, { input: '', expectedOutput: '', isHidden: false, points: 1 }],
                      }))}
                      className="btn-secondary text-xs py-1.5 px-3"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Test Case
                    </button>
                  </div>

                  <div className="flex gap-3">
                    <button onClick={handleCreateProblem} className="btn-primary">
                      <CheckCircle className="w-4 h-4" />
                      Save Problem
                    </button>
                    <button onClick={() => setShowProblemForm(false)} className="btn-secondary">Cancel</button>
                  </div>
                </div>
              </div>
            )}

            {/* Problems list */}
            <div className="space-y-3">
              {problems.map((p) => (
                <div key={p.id} className={`glass-card p-4 flex items-center justify-between ${!p.isActive ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-3">
                    <span className={`badge-${p.difficulty.toLowerCase()}`}>{p.difficulty}</span>
                    <span className="font-medium text-white">{p.title}</span>
                    <span className="text-white/30 text-xs">{p.testCases?.length || 0} test cases</span>
                    {!p.isActive && <span className="text-xs text-red-400">Inactive</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleDeleteProblem(p.id)} className="p-1.5 text-white/30 hover:text-red-400 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
              {problems.length === 0 && (
                <div className="py-12 text-center text-white/30">
                  <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No problems yet. Add some before starting the contest!</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── INCIDENTS TAB ────────────────────────────────────────────────────── */}
        {activeTab === 'incidents' && (
          <div>
            <div className="glass-card overflow-hidden">
              <div className="p-4 border-b border-white/5">
                <h3 className="font-semibold text-white flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  Anti-Cheat Incidents
                  {incidents.length > 0 && (
                    <span className="ml-2 px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-xs">{incidents.length}</span>
                  )}
                </h3>
              </div>
              {incidents.length === 0 ? (
                <div className="py-12 text-center text-white/30">
                  <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No incidents yet. Live incidents will appear here.</p>
                </div>
              ) : (
                <div className="divide-y divide-white/5">
                  {incidents.map((inc, idx) => (
                    <div key={idx} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <span className="font-medium text-white text-sm">{inc.name}</span>
                        <span className="text-white/30 text-xs ml-2">({inc.uid})</span>
                      </div>
                      <span className={`badge-${inc.count >= 3 ? 'hard' : inc.count === 2 ? 'medium' : 'easy'}`}>
                        {inc.eventType} × {inc.count}
                      </span>
                      <span className="text-white/30 text-xs">{new Date(inc.timestamp).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

