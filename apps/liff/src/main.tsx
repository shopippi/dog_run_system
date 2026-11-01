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
    // LIFF の準備に失敗した(電波が弱くて時間内に終わらない、LINE の不調など)。真っ白にせず、次にすることを出す
    root.render(
      <main className="screen">
        <div className="alert danger" role="alert">
          <p>
            <b>LINEとの接続がうまくいきませんでした。</b>
          </p>
          <p>電波のよい場所で「もう一度読み込む」を押してください。直らないときは、画面を閉じて、もう一度開いてください。</p>
          <button type="button" className="btn sub" onClick={() => window.location.reload()}>
            もう一度読み込む
          </button>
        </div>
      </main>,
    );
  });
