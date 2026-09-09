import { useEffect, useState } from 'react';
import { Trophy, Zap, CheckCircle2, Clock, Star, Home, Users, Crown } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

interface TeamMemberResult {
  userId: string;
  name: string;
  ap: number;
  problemsSolved: number;
}

interface ResultData {
  name: string;
  rollNumber: string;
  ap: number;
  rank: number;
  problemsSolved: number;
  solvedProblems: Array<{ title: string; difficulty: string; solvedAt: string }>;
  submissions: Array<{ apAwarded: number; timeTakenSeconds: number; problem: { title: string } }>;
  mode?: 'INDIVIDUAL' | 'GROUP';
  team?: {
    teamId?: string;
    teamName: string;
    captainName: string;
    totalAP: number;
    rank: number;
    totalProblemsSolved?: number;
    members: Array<TeamMemberResult>;
  } | null;
}

export default function ResultsPage() {
  const { user } = useAuth();
  const [result, setResult] = useState<ResultData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/leaderboard/results')
      .then((res) => setResult(res.data))
      .catch((err) => console.error('Results fetch error', err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen particles-bg flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!result) {
    return (
      <div className="min-h-screen particles-bg flex items-center justify-center">
        <div className="text-center text-white/40">
          <p>Could not load results. Please try again.</p>
        </div>
      </div>
    );
  }

  const isGroupMode = result.mode === 'GROUP' && Boolean(result.team);
  const displayAP = Math.max(0, result.ap);
  const displayRank = result.rank;

  const rankBadge = displayRank <= 3 && displayRank > 0
    ? ['🥇', '🥈', '🥉'][displayRank - 1]
    : `#${displayRank}`;

  // Sort team members descending by AP
  const sortedMembers = result.team?.members
    ? [...result.team.members].sort((a, b) => b.ap - a.ap)
    : [];

  return (
    <div className="min-h-screen particles-bg">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/3 w-[600px] h-[600px] bg-brand-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/3 w-[400px] h-[400px] bg-purple-600/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-2xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-8 animate-fade-in">
          <div className="text-6xl mb-4">{rankBadge}</div>
          <h1 className="text-4xl font-black text-white mb-2">
            {isGroupMode ? result.team?.teamName : result.name}
          </h1>
          <p className="text-white/40">
            {isGroupMode ? `Team Member: ${result.name} (${user?.email})` : user?.email}
          </p>
          {result.rollNumber && <p className="text-white/30 font-mono text-sm mt-1">{result.rollNumber}</p>}
        </div>

        {/* Score card */}
        <div className={`glass-card p-8 mb-6 text-center animate-slide-up ${
          isGroupMode 
            ? 'border-purple-500/30 bg-purple-500/10 shadow-[0_0_50px_rgba(168,85,247,0.15)]' 
            : 'border-brand-500/20 bg-brand-500/5'
        }`}>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-white/70 text-xs font-semibold uppercase tracking-wider mb-3">
            {isGroupMode ? <Users className="w-3.5 h-3.5 text-purple-400" /> : <Zap className="w-3.5 h-3.5 text-brand-400" />}
            {isGroupMode ? 'Team Final Score' : 'Final Score'}
          </div>
          <p className="text-7xl font-black ap-glow mb-2">{displayAP.toFixed(0)}</p>
          <p className="text-white/40">{isGroupMode ? 'Total Group AP' : 'Activity Points'}</p>

          <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-white/10">
            <div>
              <div className="flex items-center justify-center gap-1.5 text-white/40 text-xs mb-1">
                <Trophy className="w-3.5 h-3.5" />
                {isGroupMode ? 'Team Rank' : 'Rank'}
              </div>
              <p className="text-2xl font-black text-white">#{displayRank}</p>
            </div>
            <div>
              <div className="flex items-center justify-center gap-1.5 text-white/40 text-xs mb-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {isGroupMode ? 'Team Solved' : 'Solved'}
              </div>
              <p className="text-2xl font-black text-white">{result.problemsSolved}</p>
            </div>
            <div>
              <div className="flex items-center justify-center gap-1.5 text-white/40 text-xs mb-1">
                <Zap className="w-3.5 h-3.5" />
                Submissions
              </div>
              <p className="text-2xl font-black text-white">{result.submissions.length}</p>
            </div>
          </div>
        </div>

        {/* Team Members Breakdown (GROUP mode only) */}
        {isGroupMode && result.team && (
          <div className="glass-card p-6 mb-6 animate-slide-up border-purple-500/20 bg-purple-500/5" style={{ animationDelay: '0.05s' }}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-white text-lg flex items-center gap-2">
                  <Users className="w-5 h-5 text-purple-400" />
                  Team Members
                </h3>
                <p className="text-white/40 text-xs mt-0.5">Arranged in descending order by individually secured AP</p>
              </div>
              <span className="text-xs text-purple-300 font-medium bg-purple-500/20 border border-purple-500/30 px-2.5 py-1 rounded-full flex items-center gap-1">
                <Crown className="w-3 h-3 text-yellow-400" /> Captain: {result.team.captainName}
              </span>
            </div>

            <div className="space-y-2.5">
              {sortedMembers.map((m, idx) => {
                const isCaptain = m.name === result.team?.captainName;
                const isTopContributor = idx === 0 && sortedMembers.length > 1;

                return (
                  <div
                    key={m.userId}
                    className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                      isTopContributor
                        ? 'bg-purple-500/15 border-purple-500/40 shadow-sm'
                        : 'bg-white/5 border-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/60">
                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-white font-medium text-sm">{m.name}</span>
                          {isCaptain && (
                            <span className="text-[10px] bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 px-1.5 py-0.2 rounded">
                              Captain
                            </span>
                          )}
                        </div>
                        <p className="text-white/30 text-xs">
                          {m.problemsSolved ?? 0} {m.problemsSolved === 1 ? 'problem' : 'problems'} solved
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-base font-black ap-glow">
                        +{Math.max(0, m.ap).toFixed(0)} AP
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Solved problems */}
        {result.solvedProblems.length > 0 && (
          <div className="glass-card p-6 mb-6 animate-slide-up" style={{ animationDelay: '0.1s' }}>
            <h3 className="font-bold text-white mb-4 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              Problems Solved
            </h3>
            <div className="space-y-2">
              {result.solvedProblems.map((p, idx) => (
                <div key={idx} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className={`badge-${p.difficulty.toLowerCase()}`}>{p.difficulty}</span>
                    <span className="text-white text-sm font-medium">{p.title}</span>
                  </div>
                  <span className="text-white/30 text-xs">{new Date(p.solvedAt).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Submission breakdown */}
        {result.submissions.length > 0 && (
          <div className="glass-card p-6 mb-6 animate-slide-up" style={{ animationDelay: '0.2s' }}>
            <h3 className="font-bold text-white mb-4 flex items-center gap-2">
              <Star className="w-4 h-4 text-brand-400" />
              AP Breakdown
            </h3>
            <div className="space-y-2">
              {result.submissions.map((s, idx) => (
                <div key={idx} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                  <span className="text-white/70 text-sm">{s.problem.title}</span>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-white/30 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {Math.floor(s.timeTakenSeconds / 60)}m {s.timeTakenSeconds % 60}s
                    </span>
                    <span className="ap-glow font-bold">+{s.apAwarded.toFixed(0)}</span>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between pt-3 font-bold">
                <span className="text-white">Total</span>
                <span className="text-2xl ap-glow">{result.ap.toFixed(0)} AP</span>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-3 justify-center animate-fade-in" style={{ animationDelay: '0.3s' }}>
          <Link to="/leaderboard" className="btn-primary">
            <Trophy className="w-4 h-4" />
            View Leaderboard
          </Link>
          <Link to="/" className="btn-secondary">
            <Home className="w-4 h-4" />
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
