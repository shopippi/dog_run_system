import { useEffect, useState, type ReactNode } from 'react';
import { Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { AppHeader, type HeaderBack } from './components/AppHeader';
import { ErrorNotice } from './components/ErrorNotice';
import { ToastProvider } from './components/Toast';
import { skeletonFor } from './pages/skeletons';
import { useMe } from './hooks/useMe';
import { usePendingSurvey } from './hooks/usePendingSurvey';
import { RegisterFlow } from './pages/register/RegisterFlow';
import { CardPage } from './pages/card/CardPage';
import { CheckinDonePage } from './pages/checkin/CheckinDonePage';
import { CheckinPage } from './pages/checkin/CheckinPage';
import { DogEditPage } from './pages/dogs/DogEditPage';
import { DogNewPage } from './pages/dogs/DogNewPage';
import { DogsPage } from './pages/dogs/DogsPage';
import { FamilyPage } from './pages/family/FamilyPage';
import { JoinPage } from './pages/family/JoinPage';
import { SurveyPrompt } from './pages/SurveyPrompt';
import { HistoryPage } from './pages/history/HistoryPage';
import { ProfilePage } from './pages/profile/ProfilePage';
import { HelpPage } from './pages/help/HelpPage';
import { useMergeNotice } from './hooks/useMergeNotice';
import { MergeNoticeScreen } from './pages/family/MergeNoticeScreen';
import { TicketUsedPage } from './pages/tickets/TicketUsedPage';
import { CardBackgroundPage } from './pages/card/CardBackgroundPage';

export function App() {
  const { me, error, loading, reload } = useMe();
  const location = useLocation();
  const navigate = useNavigate();

  // 招待を開いたときは、登録の有無にかかわらず招待の画面を出す(C-12)
  const invite = location.pathname.startsWith('/invite/');
  let content: ReactNode;
  if (invite) {
    content = (
      <Routes>
        <Route
          path="/invite/:code"
          element={
            <JoinPage
              onJoined={() => {
                navigate('/', { replace: true });
                void reload();
              }}
            />
          }
        />
      </Routes>
    );
  } else if (loading && !me) {
    content = skeletonFor(location.pathname);
  } else if (error || !me) {
    content = (
      <main className="screen">
        <ErrorNotice error={error} onRetry={reload} />
      </main>
    );
  } else if (!me.registered) {
    content = <RegisterFlow me={me} onFinished={reload} />;
  } else {
    content = <Registered />;
  }

  return (
    <Shell>
      <AppHeader back={!invite && me?.registered ? backFor(location.pathname) : null} />
      <RouteView>{content}</RouteView>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <div className="app">{children}</div>
    </ToastProvider>
  );
}

/**
 * 画面の切り替え(docs/design.md 11.3)。新しい画面は 8px 下から 200ms でふわっと出る。
 * 戻る(ブラウザの戻る・はじめに開いたとき)は動かさない。読み込み中の形から読み込み後への切り替えも動かさない
 * (同じ URL のあいだは同じ入れ物のまま)。動きを減らす設定では動かさない(styles.css)。
 */
function RouteView({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navType = useNavigationType();
  // はじめの表示は動かさない
  const [first, setFirst] = useState(true);
  useEffect(() => {
    setFirst(false);
  }, []);
  const animate = !first && navType !== 'POP';
  return (
    <div key={location.pathname} className={`route${animate ? ' enter' : ''}`}>
      {children}
    </div>
  );
}

/** 下の階層の画面では、ヘッダーに戻り先を出す */
function backFor(path: string): HeaderBack | null {
  if (path === '/dogs/new' || /^\/dogs\/\d+$/.test(path)) return { to: '/dogs', label: 'ワンちゃん' };
  if (path === '/dogs' || path === '/family' || path === '/checkin') return { to: '/', label: '会員証' };
  if (path === '/history') return { to: '/', label: '会員証' };
  if (path === '/profile') return { to: '/', label: '会員証' };
  if (path === '/help') return { to: '/', label: '会員証' };
  if (path === '/card/background') return { to: '/', label: '会員証' };
  return null;
}

function Registered() {
  const survey = usePendingSurvey();
  const mergeNotice = useMergeNotice();
  if (mergeNotice.notice) return <MergeNoticeScreen notice={mergeNotice.notice} onDone={mergeNotice.dismiss} />;
  if (survey.questions && survey.questions.length > 0) {
    return <SurveyPrompt questions={survey.questions} onDone={survey.dismiss} />;
  }
  return (
    <Routes>
      <Route path="/checkin" element={<CheckinPage />} />
      <Route path="/checkin/done/:id" element={<CheckinDonePage />} />
      <Route path="/dogs" element={<DogsPage />} />
      <Route path="/family" element={<FamilyPage />} />
      <Route path="/dogs/new" element={<DogNewPage />} />
      <Route path="/dogs/:id" element={<DogEditPage />} />
      <Route path="/history" element={<HistoryPage />} />
      <Route path="/profile" element={<ProfilePage />} />
      <Route path="/help" element={<HelpPage />} />
      <Route path="/tickets/:id" element={<TicketUsedPage />} />
      <Route path="/card/background" element={<CardBackgroundPage />} />
      <Route path="*" element={<CardPage />} />
    </Routes>
  );
}
