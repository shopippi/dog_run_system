import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppHeader, type HeaderBack } from './components/AppHeader';
import { ErrorNotice } from './components/ErrorNotice';
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

export function App() {
  const { me, error, loading, reload } = useMe();
  const location = useLocation();
  const navigate = useNavigate();

  // 招待を開いたときは、登録の有無にかかわらず招待の画面を出す(C-12)
  if (location.pathname.startsWith('/invite/')) {
    return (
      <div className="app">
        <AppHeader />
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
      </div>
    );
  }

  return (
    <div className="app">
      <AppHeader back={me?.registered ? backFor(location.pathname) : null} />
      {loading && !me ? (
        <main className="screen">
          <p className="loading">読み込んでいます…</p>
        </main>
      ) : error || !me ? (
        <main className="screen">
          <ErrorNotice error={error} onRetry={reload} />
        </main>
      ) : !me.registered ? (
        <RegisterFlow me={me} onFinished={reload} />
      ) : (
        <Registered />
      )}
    </div>
  );
}

/** 下の階層の画面では、ヘッダーに戻り先を出す */
function backFor(path: string): HeaderBack | null {
  if (path === '/dogs/new' || /^\/dogs\/\d+$/.test(path)) return { to: '/dogs', label: 'ワンちゃん' };
  if (path === '/dogs' || path === '/family' || path === '/checkin') return { to: '/', label: '会員証' };
  return null;
}

function Registered() {
  const survey = usePendingSurvey();
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
      <Route path="*" element={<CardPage />} />
    </Routes>
  );
}
