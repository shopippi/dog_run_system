import { Route, Routes } from 'react-router-dom';
import { ErrorNotice } from './components/ErrorNotice';
import { Layout } from './components/Layout';
import { AuthProvider, useAuth } from './lib/auth';
import { LoginPage } from './pages/LoginPage';
import { ProxyCheckin } from './components/ProxyCheckin';
import { SearchPage } from './pages/SearchPage';
import { TodayPage } from './pages/TodayPage';
import { HouseholdPage } from './pages/HouseholdPage';
import { MergePage } from './pages/MergePage';
import { RequestsPage } from './pages/RequestsPage';
import { EventsPage } from './pages/EventsPage';
import { SurveyQuestionsPage } from './pages/SurveyQuestionsPage';
import { BreedsPage } from './pages/BreedsPage';
import { SettingsPage } from './pages/SettingsPage';
import { StaffPage } from './pages/StaffPage';
import { AuditPage } from './pages/AuditPage';
import { HelpPage } from './pages/HelpPage';
import { StatusPage } from './pages/StatusPage';
import { ExportPage } from './pages/ExportPage';
import { DashboardPage } from './pages/DashboardPage';
import { DogEditPage } from './pages/DogEditPage';
import { MigrationPage } from './pages/MigrationPage';

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
      <main className="login">
        <div className="login-box">
          <ErrorNotice error={error} onRetry={() => location.reload()} />
        </div>
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
              title="代理チェックイン"
              howto="スマホを持っていないお客さんを、犬の名前や会員IDで探して選び、来たワンちゃんを選んで「代理でチェックインする」を押してください。紙に書いた分は、来場日を選んで入力できます。"
              actions={(h) => <ProxyCheckin h={h} />}
            />
          }
        />
        <Route path="/households/:id" element={<HouseholdPage />} />
        <Route path="/dogs/:id" element={<DogEditPage />} />
        <Route path="/merge" element={<MergePage />} />
        <Route path="/requests" element={<RequestsPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/survey-questions" element={<SurveyQuestionsPage />} />
        <Route path="/breeds" element={<BreedsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/staff" element={<StaffPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/status" element={<StatusPage />} />
        <Route path="/export" element={<ExportPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/migration" element={<MigrationPage />} />
        <Route path="*" element={<Placeholder />} />
      </Routes>
    </Layout>
  );
}

function Placeholder() {
  return (
    <div className="page">
      <div className="panel">
        <p className="empty">この画面は準備中です。メニューから別の画面を選んでください。</p>
      </div>
    </div>
  );
}
