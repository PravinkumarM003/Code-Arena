import { useEffect, useState } from 'react';
import { Trophy, Zap, Users, Clock, RefreshCw } from 'lucide-react';
import api from '../lib/api';
import { getExistingSocket } from '../lib/socket';

interface LeaderboardEntry {
  userId: string;
  name: string;
  rollNumber: string;
  ap: number;
  rank: number;
  problemsSolved: number;
}

interface LeaderboardData {
  leaderboard: LeaderboardEntry[];
  combinedTotal: number;
  participantCount: number;
  contestState: string;
  remainingMs: number;
}

function formatTime(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, s % 60 > 0 ? sec : sec].map((v) => String(v).padStart(2, '0')).join(':');
}

const RANK_STYLES: Record<number, { medal: string; bg: string; border: string; text: string }> = {
  1: { medal: '🥇', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400' },
  2: { medal: '🥈', bg: 'bg-slate-400/10', border: 'border-slate-400/30', text: 'text-slate-300' },
  3: { medal: '🥉', bg: 'bg-amber-600/10', border: 'border-amber-600/30', text: 'text-amber-500' },
};

export default function LeaderboardPage() {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(Date.now());

  const fetchLeaderboard = async () => {
    try {
      const res = await api.get('/leaderboard/top');
      setData(res.data);
      setLastUpdated(Date.now());
    } catch (err) {
      console.error('Leaderboard fetch error', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 5000); // refresh every 5s
    return () => clearInterval(interval);
  }, []);

  // Listen for leaderboard:update socket event
  useEffect(() => {
    const socket = getExistingSocket();
    if (!socket) return;
    const handler = () => fetchLeaderboard();
    socket.on('leaderboard:update', handler);
    return () => { socket.off('leaderboard:update', handler); };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen particles-bg flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/50">Loading leaderboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen particles-bg">
      {/* Background orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-brand-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8 animate-fade-in">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-yellow-500 to-amber-600 shadow-2xl shadow-yellow-500/30 mb-4">
            <Trophy className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-black text-gradient mb-2">Live Leaderboard</h1>
          <p className="text-white/40 text-sm">CodeArena — Real-time Rankings</p>
        </div>

        {/* Stats strip */}
        {data && (
          <div className="grid grid-cols-3 gap-4 mb-6 animate-slide-up">
            <div className="glass-card p-4 text-center">
              <div className="flex items-center justify-center gap-1.5 text-white/40 text-xs mb-1">
                <Users className="w-3.5 h-3.5" />
                Participants
              </div>
              <p className="text-2xl font-black text-white">{data.participantCount}</p>
            </div>
            <div className="glass-card p-4 text-center">
              <div className="flex items-center justify-center gap-1.5 text-white/40 text-xs mb-1">
                <Zap className="w-3.5 h-3.5" />
                Total AP
              </div>
              <p className="text-2xl font-black ap-glow">{data.combinedTotal.toFixed(0)}</p>
            </div>
            <div className="glass-card p-4 text-center">
              <div className="flex items-center justify-center gap-1.5 text-white/40 text-xs mb-1">
                <Clock className="w-3.5 h-3.5" />
                {data.contestState === 'RUNNING' ? 'Remaining' : 'Status'}
              </div>
              {data.contestState === 'RUNNING' ? (
                <p className="text-2xl font-black font-mono text-white">{formatTime(data.remainingMs)}</p>
              ) : (
                <p className={`text-lg font-bold ${
                  data.contestState === 'WAITING' ? 'text-blue-400' :
                  data.contestState === 'PAUSED' ? 'text-amber-400' : 'text-red-400'
                }`}>{data.contestState}</p>
              )}
            </div>
          </div>
        )}

        {/* Leaderboard entries */}
        <div className="space-y-3">
          {data?.leaderboard.map((entry, idx) => {
            const style = RANK_STYLES[entry.rank];

            return (
              <div
                key={entry.userId}
                className={`relative flex items-center gap-4 p-4 rounded-2xl border transition-all duration-300 animate-slide-up
                  ${style ? `${style.bg} ${style.border}` : 'glass-card'}`}
                style={{ animationDelay: `${idx * 0.05}s` }}
              >
                {/* Rank */}
                <div className="flex-shrink-0 w-12 text-center">
                  {style ? (
                    <span className="text-3xl">{style.medal}</span>
                  ) : (
                    <span className={`text-xl font-black text-white/40`}>#{entry.rank}</span>
                  )}
                </div>

                {/* Name + Roll */}
                <div className="flex-1 min-w-0">
                  <p className={`font-bold text-lg truncate ${style ? style.text : 'text-white'}`}>
                    {entry.name}
                  </p>
                  <p className="text-white/30 text-xs font-mono">{entry.rollNumber || '—'}</p>
                </div>

                {/* Problems solved */}
                <div className="text-center flex-shrink-0">
                  <p className="text-white font-bold">{entry.problemsSolved}</p>
                  <p className="text-white/30 text-xs">solved</p>
                </div>

                {/* AP */}
                <div className="text-right flex-shrink-0">
                  <p className={`text-2xl font-black ${style ? style.text : 'ap-glow'}`}>
                    {entry.ap.toFixed(0)}
                  </p>
                  <p className="text-white/30 text-xs">AP</p>
                </div>

                {/* Top 1 glow effect */}
                {entry.rank === 1 && (
                  <div className="absolute inset-0 rounded-2xl bg-yellow-500/5 animate-pulse-slow" />
                )}
              </div>
            );
          })}

          {data?.leaderboard.length === 0 && (
            <div className="glass-card py-16 text-center">
              <Trophy className="w-12 h-12 mx-auto mb-3 text-white/20" />
              <p className="text-white/40">No scores yet. Contest hasn't started.</p>
            </div>
          )}
        </div>

        {/* Last updated */}
        <div className="mt-6 text-center text-white/20 text-xs flex items-center justify-center gap-1.5">
          <RefreshCw className="w-3 h-3" />
          Last updated {new Date(lastUpdated).toLocaleTimeString()} · Auto-refreshes every 5s
        </div>
      </div>
    </div>
  );
}
