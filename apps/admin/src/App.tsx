import { Route, Routes } from 'react-router-dom';
import { ErrorNotice } from './components/ErrorNotice';
import { Layout } from './components/Layout';
import { AuthProvider, useAuth } from './lib/auth';
import { LoginPage } from './pages/LoginPage';
import { ProxyCheckin } from './components/ProxyCheckin';
import { SearchPage } from './pages/SearchPage';
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
        <Route path="/search" element={<SearchPage />} />
        <Route
          path="/proxy"
          element={
            <SearchPage
              key="proxy"
              howto="スマホを持っていないお客さんを、犬の名前や会員IDで探して選び、来たワンちゃんを選んで「代理でチェックインする」を押してください。紙に書いた分は、来場日を選んで入力できます。"
              actions={(h) => <ProxyCheckin h={h} />}
            />
          }
        />
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
