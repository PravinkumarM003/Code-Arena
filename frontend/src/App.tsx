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
  const { contestState } = useContest();

  if (isAdmin) {
    return <AdminDashboard />;
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

