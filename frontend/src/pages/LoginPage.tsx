import { Code2, Loader2, LogIn } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const { signInWithGoogle, loading } = useAuth();

  return (
    <div className="min-h-screen particles-bg flex items-center justify-center p-4">
      {/* Animated background orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-brand-600/20 rounded-full blur-3xl animate-pulse-slow" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-brand-900/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md animate-fade-in">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-2xl shadow-brand-500/40 mb-6 animate-glow">
            <Code2 className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-black text-gradient mb-2">CodeArena</h1>
          <p className="text-white/50 text-sm font-medium tracking-widest uppercase">
            Live Coding Contest Platform
          </p>
        </div>

        {/* Login Card */}
        <div className="glass-card p-8 animate-slide-up">
          <div className="space-y-4 mb-8">
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-brand-400 mt-2 flex-shrink-0" />
              <p className="text-white/70 text-sm">3-hour live coding competition</p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-emerald-400 mt-2 flex-shrink-0" />
              <p className="text-white/70 text-sm">AI-graded submissions with instant feedback</p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-amber-400 mt-2 flex-shrink-0" />
              <p className="text-white/70 text-sm">Earn Activity Points, climb the leaderboard</p>
            </div>
          </div>

          <button
            onClick={signInWithGoogle}
            disabled={loading}
            className="btn-primary w-full justify-center text-base"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <LogIn className="w-5 h-5" />
                Sign in with Google
              </>
            )}
          </button>

          <p className="text-center text-white/30 text-xs mt-4">
            Only @{import.meta.env.VITE_COLLEGE_EMAIL_DOMAIN || 'college.edu'} accounts
          </p>
        </div>

        {/* Monitoring notice */}
        <div className="mt-4 glass-card px-4 py-3 border-amber-500/20 bg-amber-500/5">
          <p className="text-amber-400/80 text-xs text-center">
            🔍 This contest is monitored for academic integrity.
            Tab switches, copy-paste, and DevTools usage are logged.
          </p>
        </div>
      </div>
    </div>
  );
}
