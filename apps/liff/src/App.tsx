import { Route, Routes } from 'react-router-dom';
import { AppHeader } from './components/AppHeader';
import { ErrorNotice } from './components/ErrorNotice';
import { useMe } from './hooks/useMe';
import { RegisterFlow } from './pages/register/RegisterFlow';

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
        <Routes>
          <Route path="*" element={<Home memberNo={me.household.memberNo} name={me.household.displayName} />} />
        </Routes>
      )}
    </div>
  );
}

function Home({ memberNo, name }: { memberNo: string; name: string }) {
  return (
    <main className="screen">
      <div className="panel">
        <h2>{name}</h2>
        <p className="mono">{memberNo}</p>
      </div>
    </main>
  );
}
