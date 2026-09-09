import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Code2, Zap, Shield, LogIn } from 'lucide-react';
import { useContest } from '../contexts/ContestContext';
import { useAuth } from '../contexts/AuthContext';

export default function HomePage() {
  const navigate = useNavigate();
  const { contestState } = useContest();
  const { user } = useAuth();

  // Auto-redirect: if the contest is already running/paused, take the user straight to /contest
  useEffect(() => {
    if (contestState === 'RUNNING' || contestState === 'PAUSED') {
      navigate('/contest', { replace: true });
    }
  }, [contestState, navigate]);

  const handleEnterContest = () => {
    if (!user) {
      navigate('/login');
    } else {
      navigate('/contest');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-[#0a0f1a] via-[#111827] to-[#0a0f1a] text-white p-6 overflow-hidden relative">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-brand-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-0 w-80 h-80 bg-purple-600/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 flex flex-col items-center text-center max-w-xl w-full">
        {/* Logo */}
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-2xl shadow-brand-500/40 mb-6 animate-fade-in">
          <Code2 className="w-10 h-10 text-white" />
        </div>

        <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight mb-3 animate-slide-up">
          Code<span className="text-brand-400">Arena</span>
        </h1>
        <p className="text-white/50 text-lg max-w-sm mb-10 animate-slide-up" style={{ animationDelay: '0.05s' }}>
          Competitive coding with real‑time judging, live leaderboards, and group team battles.
        </p>

        {/* Features strip */}
        <div className="flex flex-wrap justify-center gap-3 mb-10 animate-slide-up" style={{ animationDelay: '0.1s' }}>
          {[
            { icon: <Zap className="w-3.5 h-3.5" />, label: 'Real-time Judging' },
            { icon: <Users className="w-3.5 h-3.5" />, label: 'Team Mode' },
            { icon: <Shield className="w-3.5 h-3.5" />, label: 'Anti-Cheat' },
          ].map(({ icon, label }) => (
            <div key={label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-white/50 text-xs">
              {icon}
              {label}
            </div>
          ))}
        </div>

        {/* Contest status indicator */}
        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium mb-8 border animate-fade-in ${
          contestState === 'WAITING'
            ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
            : contestState === 'ENDED'
            ? 'bg-red-500/10 border-red-500/20 text-red-400'
            : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
        }`} style={{ animationDelay: '0.15s' }}>
          <span className={`w-2 h-2 rounded-full animate-pulse ${
            contestState === 'WAITING' ? 'bg-blue-400' :
            contestState === 'ENDED' ? 'bg-red-400' : 'bg-emerald-400'
          }`} />
          {contestState === 'WAITING' ? 'Contest not started yet — stand by' :
           contestState === 'ENDED' ? 'Contest has ended' :
           'Contest is live! Redirecting...'}
        </div>

        {/* CTA Button */}
        <button
          id="home-enter-contest"
          onClick={handleEnterContest}
          className="px-8 py-4 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-700 text-white font-bold text-base shadow-lg shadow-brand-500/30 hover:scale-105 active:scale-95 transition-all flex items-center gap-2 animate-slide-up"
          style={{ animationDelay: '0.2s' }}
        >
          <LogIn className="w-5 h-5" />
          {user ? 'Enter Contest' : 'Sign In & Enter'}
        </button>
      </div>
    </div>
  );
}


