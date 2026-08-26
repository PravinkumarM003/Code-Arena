import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuth } from './contexts/AuthContext';
import { useContest } from './contexts/ContestContext';
import { ProtectedRoute } from './components/ProtectedRoute';

// ── Eager: shown on first load — must NOT be lazy ──────────────────────────
import LoginPage from './pages/LoginPage';
import HoldingScreen from './pages/HoldingScreen';

// ── Lazy: only downloaded when the user navigates to that route ─────────────
// Each becomes its own JS chunk → reduces initial bundle by ~65 KB
const ContestPage    = lazy(() => import('./pages/ContestPage'));
const EndedScreen    = lazy(() => import('./pages/EndedScreen'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage'));
const ResultsPage    = lazy(() => import('./pages/ResultsPage'));
const CompilerPage   = lazy(() => import('./pages/CompilerPage'));

/** Minimal spinner that matches brand colours — shown during chunk download */
function PageLoader() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: '#0a0f1a',
    }}>
      <div style={{
        width: 36, height: 36,
        border: '3px solid rgba(41,82,247,.3)',
        borderTopColor: '#2952f7',
        borderRadius: '50%',
        animation: 'spin .7s linear infinite',
      }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

/**
 * Smart contest router: selects the correct screen based on
 * contest state and user role. The server is always the source of truth.
 */
function ContestRouter() {
  const { isAdmin } = useAuth();
  const { contestState, isLocked, isSessionRestored } = useContest();

  if (isAdmin) {
    return <AdminDashboard />;
  }

  if (!isSessionRestored) {
    return <PageLoader />;
  }

  if (isLocked) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] flex flex-col items-center justify-center p-6 text-center select-none">
        <div className="w-24 h-24 rounded-3xl bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-6 shadow-2xl shadow-red-500/20 animate-pulse">
          <span className="text-5xl">🔒</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white mb-3">Account Locked</h1>
        <p className="text-red-400 font-medium text-base sm:text-lg max-w-md mb-2">
          Your account has been locked due to security violations or administrative action.
        </p>
        <p className="text-white/40 text-sm max-w-sm mb-8">
          Please contact the event administrator to unlock your account. Once unlocked, your screen will resume automatically.
        </p>
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-white/50 text-xs font-mono">
          <span className="w-2 h-2 rounded-full bg-red-400 animate-ping" />
          Awaiting administrator unlock...
        </div>
      </div>
    );
  }

  switch (contestState) {
    case 'WAITING':
      return <HoldingScreen />;
    case 'RUNNING':
    case 'PAUSED':
      return <ContestPage />;
    case 'ENDED':
      return <EndedScreen />;
    default:
      return <HoldingScreen />;
  }
}

export default function App() {
  return (
    <>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#1e2535',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '12px',
            fontSize: '14px',
          },
          success: {
            iconTheme: { primary: '#10b981', secondary: '#fff' },
          },
          error: {
            iconTheme: { primary: '#ef4444', secondary: '#fff' },
          },
        }}
      />

      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/compiler" element={<CompilerPage />} />

          {/* Protected */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <ContestRouter />
              </ProtectedRoute>
            }
          />
          <Route
            path="/results"
            element={
              <ProtectedRoute>
                <ResultsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute requireAdmin>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}

