import { Flag, Trophy, Home } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useContest } from '../contexts/ContestContext';

export default function EndedScreen() {
  const { user } = useAuth();
  const { ap, rank } = useContest();

  return (
    <div className="min-h-screen particles-bg flex items-center justify-center">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-brand-600/10 rounded-full blur-3xl animate-pulse-slow" />
      </div>

      <div className="relative z-10 text-center max-w-md px-4 animate-fade-in">
        <div className="inline-flex items-center justify-center w-24 h-24 rounded-3xl bg-gradient-to-br from-brand-500 to-purple-600 shadow-2xl shadow-brand-500/40 mb-6">
          <Flag className="w-12 h-12 text-white" />
        </div>

        <h1 className="text-5xl font-black text-gradient mb-2">Contest Ended!</h1>
        <p className="text-white/50 mb-8">Thank you for participating in CodeArena.</p>

        <div className="glass-card p-8 mb-6">
          <p className="text-white/40 text-sm mb-1">Your Score</p>
          <p className="text-6xl font-black ap-glow mb-1">{ap.toFixed(0)}</p>
          <p className="text-white/30 text-sm">Activity Points</p>
          {rank > 0 && (
            <p className="text-white/60 mt-4 text-lg font-semibold">
              Rank #{rank}
            </p>
          )}
        </div>

        <div className="flex gap-3 justify-center">
          <Link to="/results" className="btn-primary">
            View Full Results
          </Link>
          <Link to="/leaderboard" className="btn-secondary">
            <Trophy className="w-4 h-4" />
            Leaderboard
          </Link>
        </div>
      </div>
    </div>
  );
}
