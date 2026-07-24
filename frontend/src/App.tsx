import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuth } from './contexts/AuthContext';
import { useContest } from './contexts/ContestContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import HoldingScreen from './pages/HoldingScreen';
import ContestPage from './pages/ContestPage';
import EndedScreen from './pages/EndedScreen';
import AdminDashboard from './pages/AdminDashboard';
import LeaderboardPage from './pages/LeaderboardPage';
import ResultsPage from './pages/ResultsPage';

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

      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />

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
    </>
  );
}
