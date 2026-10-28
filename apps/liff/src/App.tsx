import { Route, Routes } from 'react-router-dom';
import { AppHeader } from './components/AppHeader';

export function App() {
  return (
    <div className="app">
      <AppHeader />
      <Routes>
        <Route path="*" element={<Home />} />
      </Routes>
    </div>
  );
}

function Home() {
  return (
    <main className="screen">
      <div className="panel">
        <h2>ドッグラン会員証</h2>
        <p className="muted">準備中です。</p>
      </div>
    </main>
  );
}
