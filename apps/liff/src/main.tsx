import '@dr/shared/tokens.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { initLiff } from './lib/liff';

const root = createRoot(document.getElementById('root')!);

initLiff()
  .then(() => {
    root.render(
      <StrictMode>
        <BrowserRouter basename="/liff">
          <App />
        </BrowserRouter>
      </StrictMode>,
    );
  })
  .catch(() => {
    root.render(
      <main className="screen">
        <div className="notice bad">
          <p>LINEとの接続がうまくいきませんでした。</p>
          <p>画面を閉じて、もう一度開いてください。</p>
        </div>
      </main>,
    );
  });
