import '@dr/shared/tokens.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { App } from './App';
import { installDemoFetch, installDemoImages } from './lib/demo-fetch';

// デモ(apps/demo)のときだけ、API への要求を親の画面の中の API に送る。静的な配信先で開けるよう、URL はハッシュにする
const isDemo = import.meta.env.VITE_DEMO === '1';
if (isDemo) {
  installDemoFetch();
  installDemoImages();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDemo ? (
      <HashRouter>
        <App />
      </HashRouter>
    ) : (
      <BrowserRouter basename="/admin">
        <App />
      </BrowserRouter>
    )}
  </StrictMode>,
);
