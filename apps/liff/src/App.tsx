import { Link, Route, Routes } from 'react-router-dom';
import { AppHeader } from './components/AppHeader';
import { ErrorNotice } from './components/ErrorNotice';
import { useMe } from './hooks/useMe';
import { usePendingSurvey } from './hooks/usePendingSurvey';
import { RegisterFlow } from './pages/register/RegisterFlow';
import { DogEditPage } from './pages/dogs/DogEditPage';
import { DogNewPage } from './pages/dogs/DogNewPage';
import { DogsPage } from './pages/dogs/DogsPage';
import { SurveyPrompt } from './pages/SurveyPrompt';

export function App() {
  const { me, error, loading, reload } = useMe();

  return (
    <div className="app">
      <AppHeader />
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
        <Registered memberNo={me.household.memberNo} name={me.household.displayName} />
      )}
    </div>
  );
}

function Registered({ memberNo, name }: { memberNo: string; name: string }) {
  const survey = usePendingSurvey();
  if (survey.questions && survey.questions.length > 0) {
    return <SurveyPrompt questions={survey.questions} onDone={survey.dismiss} />;
  }
  return (
    <Routes>
      <Route path="/dogs" element={<DogsPage />} />
      <Route path="/dogs/new" element={<DogNewPage />} />
      <Route path="/dogs/:id" element={<DogEditPage />} />
      <Route path="*" element={<Home memberNo={memberNo} name={name} />} />
    </Routes>
  );
}

function Home({ memberNo, name }: { memberNo: string; name: string }) {
  return (
    <main className="screen">
      <div className="panel">
        <h2>{name}</h2>
        <p className="mono">{memberNo}</p>
      </div>
      <Link to="/dogs" className="btn sub as-link">
        ワンちゃん
      </Link>
    </main>
  );
}
