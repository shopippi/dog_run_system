// 画面(iframe)との橋渡し。iframe の差し替えた fetch から届いた要求を、ブラウザの中の API で処理して返す。
// LINE のモックからの「トークに送る」「QR コードを読み取る」も、ここで受け取る。

import type { BridgeRequest, DemoEngine } from './engine/engine';

export type FrameName = 'liff' | 'admin';

export type BridgeHandlers = {
  frames: () => Partial<Record<FrameName, HTMLIFrameElement | null>>;
  onShare: (text: string) => void;
  /** 受付の QR コードの中身(URL)を返す */
  onScan: () => string;
  /** 画面から書き込みの操作があったとき */
  onWrite?: (frame: FrameName, url: string) => void;
};

export function startBridge(engine: DemoEngine, h: BridgeHandlers): () => void {
  const onMessage = async (e: MessageEvent) => {
    const frames = h.frames();
    const name = (Object.keys(frames) as FrameName[]).find((k) => frames[k]?.contentWindow === e.source);
    if (!name || !e.source) return;
    const source = e.source as Window;
    const d = e.data as { type?: string; id?: number | string; text?: string } & Partial<BridgeRequest>;
    if (d?.type === 'dr-demo-fetch' && typeof d.id === 'number') {
      let result;
      try {
        result = await engine.handle(
          { method: d.method ?? 'GET', url: d.url ?? '/', headers: d.headers ?? [], body: d.body ?? null },
          name,
        );
      } catch (err) {
        console.error(err);
        const body = new TextEncoder().encode(
          JSON.stringify({ error: { code: 'internal', message: 'うまく処理できませんでした。「最初からやり直す」を押してください。' } }),
        ).buffer as ArrayBuffer;
        result = { status: 500, statusText: '', headers: [['content-type', 'application/json']] as [string, string][], body };
      }
      source.postMessage({ type: 'dr-demo-fetch-result', id: d.id, result }, '*', result.body ? [result.body] : []);
      const method = (d.method ?? 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD' && result.status < 400) h.onWrite?.(name, d.url ?? '');
    } else if (d?.type === 'line-share' && typeof d.text === 'string') {
      h.onShare(d.text);
    } else if (d?.type === 'scan-request') {
      source.postMessage({ type: 'scan-result', id: d.id, value: h.onScan() }, '*');
    }
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
