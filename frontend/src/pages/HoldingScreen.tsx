import { useEffect, useState } from 'react';
import { Users, Clock, Code2, Wifi, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useContest } from '../contexts/ContestContext';

export default function HoldingScreen() {
  const { user, logout } = useAuth();
  const { connectedCount, contestState } = useContest();
  const [dots, setDots] = useState('');
  const [particles, setParticles] = useState<Array<{ id: number; x: number; y: number; size: number; speed: number }>>([]);

  // Animated dots
  useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Generate floating particles
  useEffect(() => {
    setParticles(
      Array.from({ length: 20 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 3 + 1,
        speed: Math.random() * 3 + 2,
      }))
    );
  }, []);

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Student';

  return (
    <div className="min-h-screen particles-bg flex flex-col overflow-hidden">
      {/* Particles */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        {particles.map((p) => (
          <div
            key={p.id}
            className="absolute rounded-full bg-brand-400/20"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              animation: `float ${p.speed}s ease-in-out infinite alternate`,
            }}
          />
        ))}
      </div>

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
            <Code2 className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-white">CodeArena</span>
        </div>
        <button onClick={logout} className="flex items-center gap-2 text-white/40 hover:text-white/70 text-sm transition-colors">
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </header>

      {/* Main content */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 py-12">
        {/* Status indicator */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm font-medium mb-8 animate-fade-in">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          Contest has not started yet
        </div>

        {/* Welcome card */}
        <div className="glass-card w-full max-w-md p-8 mb-8 text-center animate-slide-up">
          {/* Avatar */}
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-brand-500/30">
            {user?.photoURL ? (
              <img src={user.photoURL} alt="Avatar" className="w-full h-full rounded-full object-cover" />
            ) : (
              <span className="text-2xl font-black text-white">
                {displayName.charAt(0).toUpperCase()}
              </span>
            )}
          </div>

          <h2 className="text-2xl font-bold text-white mb-1">{displayName}</h2>
          <p className="text-white/40 text-sm mb-6">{user?.email}</p>

          {/* Waiting message */}
          <div className="bg-white/5 rounded-xl p-4 mb-4">
            <div className="flex items-center justify-center gap-2 text-white/60 mb-2">
              <Clock className="w-4 h-4" />
              <span className="text-sm font-medium">Waiting for contest to start{dots}</span>
            </div>
            <p className="text-white/30 text-xs">
              The admin will start the contest shortly. Stay on this page.
            </p>
          </div>
        </div>

        {/* Live connection counter */}
        <div className="glass-card px-8 py-6 text-center animate-slide-up" style={{ animationDelay: '0.1s' }}>
          <div className="flex items-center justify-center gap-3 mb-2">
            <div className="relative">
              <Users className="w-6 h-6 text-brand-400" />
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-surface-950 animate-pulse" />
            </div>
            <span
              key={connectedCount}
              className="text-4xl font-black text-white animate-count-up"
            >
              {connectedCount}
            </span>
            <span className="text-white/30 text-sm">/ 500</span>
          </div>
          <p className="text-white/40 text-sm flex items-center justify-center gap-1.5">
            <Wifi className="w-3.5 h-3.5" />
            participants connected
          </p>

          {/* Progress bar */}
          <div className="mt-4 w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-brand-500 to-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, (connectedCount / 500) * 100)}%` }}
            />
          </div>
        </div>

        {/* Info strip */}
        <div className="mt-8 flex gap-4 flex-wrap justify-center animate-fade-in" style={{ animationDelay: '0.2s' }}>
          {[
            { icon: '⏱', label: '3 Hour Contest' },
            { icon: '🤖', label: 'AI-Graded Code' },
            { icon: '🏆', label: 'Live Leaderboard' },
            { icon: '🔍', label: 'Monitored Session' },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-white/50 text-xs">
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes float {
          from { transform: translateY(0px) rotate(0deg); }
          to { transform: translateY(-20px) rotate(180deg); }
        }
      `}</style>
    </div>
  );
}
