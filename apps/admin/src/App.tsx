import { Route, Routes } from 'react-router-dom';

export function App() {
  return (
    <div className="console">
      <header className="con-head">
        <h1>ドッグラン 受付・管理</h1>
      </header>
      <Routes>
        <Route path="*" element={<Placeholder />} />
      </Routes>
    </div>
  );
}

function Placeholder() {
  return (
    <main className="con-body">
      <p className="muted">準備中です。</p>
    </main>
  );
}
