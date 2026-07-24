import { useEffect, useState } from 'react';
import { Trophy, Zap, CheckCircle2, Clock, Star, Home } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

interface ResultData {
  name: string;
  rollNumber: string;
  ap: number;
  rank: number;
  problemsSolved: number;
  solvedProblems: Array<{ title: string; difficulty: string; solvedAt: string }>;
  submissions: Array<{ apAwarded: number; timeTakenSeconds: number; problem: { title: string } }>;
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

  const rankBadge = result.rank <= 3
    ? ['🥇', '🥈', '🥉'][result.rank - 1]
    : `#${result.rank}`;

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
          <h1 className="text-4xl font-black text-white mb-2">{result.name}</h1>
          <p className="text-white/40">{user?.email}</p>
          {result.rollNumber && <p className="text-white/30 font-mono text-sm mt-1">{result.rollNumber}</p>}
        </div>

        {/* Score card */}
        <div className="glass-card p-8 mb-6 text-center animate-slide-up border-brand-500/20 bg-brand-500/5">
          <p className="text-white/50 text-sm mb-2">Final Score</p>
          <p className="text-7xl font-black ap-glow mb-2">{result.ap.toFixed(0)}</p>
          <p className="text-white/40">Activity Points</p>

          <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-white/10">
            <div>
              <div className="flex items-center justify-center gap-1.5 text-white/40 text-xs mb-1">
                <Trophy className="w-3.5 h-3.5" />
                Rank
              </div>
              <p className="text-2xl font-black text-white">#{result.rank}</p>
            </div>
            <div>
              <div className="flex items-center justify-center gap-1.5 text-white/40 text-xs mb-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Solved
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
