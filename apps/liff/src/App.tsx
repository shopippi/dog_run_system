import { Route, Routes } from 'react-router-dom';
import { AppHeader } from './components/AppHeader';
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
        <Registered />
      )}
    </div>
  );
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
      <Route path="/dogs/new" element={<DogNewPage />} />
      <Route path="/dogs/:id" element={<DogEditPage />} />
      <Route path="*" element={<CardPage />} />
    </Routes>
  );
}
