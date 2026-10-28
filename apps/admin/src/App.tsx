import { Route, Routes } from 'react-router-dom';
import { ErrorNotice } from './components/ErrorNotice';
import { Layout } from './components/Layout';
import { AuthProvider, useAuth } from './lib/auth';
import { LoginPage } from './pages/LoginPage';
import { TodayPage } from './pages/TodayPage';

export function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

function Gate() {
  const { staff, loading, error } = useAuth();
  if (loading && !staff) return <p className="loading">読み込んでいます…</p>;
  if (error) {
    return (
      <main className="con-body">
        <ErrorNotice error={error} onRetry={() => location.reload()} />
      </main>
    );
  }
  if (!staff) return <LoginPage />;
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<TodayPage />} />
        <Route path="*" element={<Placeholder />} />
      </Routes>
    </Layout>
  );
}

function Placeholder() {
  return (
    <main className="con-body">
      <p className="muted">準備中です。</p>
    </main>
  );
}
