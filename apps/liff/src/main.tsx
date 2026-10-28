import '@dr/shared/tokens.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { App } from './App';
import { installDemoFetch, installDemoImages } from './lib/demo-fetch';
import { initLiff } from './lib/liff';

// デモ(apps/demo)のときだけ、API への要求を親の画面の中の API に送る。静的な配信先で開けるよう、URL はハッシュにする
const isDemo = import.meta.env.VITE_DEMO === '1';
if (isDemo) {
  installDemoFetch();
  installDemoImages();
}

const root = createRoot(document.getElementById('root')!);

initLiff()
  .then(() => {
    root.render(
      <StrictMode>
        {isDemo ? (
          <HashRouter>
            <App />
          </HashRouter>
        ) : (
          <BrowserRouter basename="/liff">
            <App />
          </BrowserRouter>
        )}
      </StrictMode>,
    );
  })
  .catch(() => {
    root.render(
      <main className="screen">
        <div className="alert danger" role="alert">
          <p>LINEとの接続がうまくいきませんでした。</p>
          <p>画面を閉じて、もう一度開いてください。</p>
        </div>
      </main>,
    );
  });
