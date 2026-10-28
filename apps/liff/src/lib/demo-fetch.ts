// デモ(VITE_DEMO=1)のときだけ使う。API への要求を、親の画面(apps/demo)の中で動く API に送る。
// 親は iframe ごとに要求を受け取り、ブラウザの中の API(Hono + sql.js)で処理して応答を返す。

type DemoResult = { status: number; statusText: string; headers: [string, string][]; body: ArrayBuffer | null };

const API_PREFIXES = ['/api/', '/admin/api/'];

/** API への要求なら、パス(とクエリ)を返す */
function apiPath(input: RequestInfo | URL): string | null {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (API_PREFIXES.some((p) => raw.startsWith(p))) return raw;
  try {
    const u = new URL(raw, location.href);
    if (u.origin === location.origin && API_PREFIXES.some((p) => u.pathname.startsWith(p))) return u.pathname + u.search;
  } catch {
    // URL でなければ API ではない
  }
  return null;
}

const targetOrigin = () => (location.origin === 'null' ? '*' : location.origin);

let seq = 0;
const pending = new Map<number, (r: DemoResult) => void>();

export function installDemoFetch(): void {
  const native = window.fetch.bind(window);
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const d = e.data as { type?: string; id?: number; result?: DemoResult };
    if (d?.type !== 'dr-demo-fetch-result' || typeof d.id !== 'number' || !d.result) return;
    pending.get(d.id)?.(d.result);
    pending.delete(d.id);
  });

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = apiPath(input);
    if (!path || window.parent === window) return native(input, init);
    const req = new Request(input instanceof Request ? input : new URL(path, location.href), init);
    const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.arrayBuffer();
    const headers: [string, string][] = [];
    req.headers.forEach((v, k) => headers.push([k, v]));
    const id = ++seq;
    const result = await new Promise<DemoResult>((resolve) => {
      pending.set(id, resolve);
      window.parent.postMessage({ type: 'dr-demo-fetch', id, method: req.method, url: path, headers, body }, targetOrigin(), body ? [body] : []);
    });
    const nullBody = result.status === 204 || result.status === 304 || result.body === null;
    return new Response(nullBody ? null : result.body, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
    });
  };
}

const blobs = new Map<string, Promise<string | null>>();

/**
 * <img src="/admin/api/media/..."> のような、API の写真を直接読む画像は fetch を通らないため、
 * 差し替えた fetch で読み、画面の中だけで使える URL(blob:)に置き換える。
 */
export function installDemoImages(): void {
  const fix = (img: HTMLImageElement) => {
    const src = img.getAttribute('src');
    if (!src || !apiPath(src) || src.startsWith('blob:')) return;
    let p = blobs.get(src);
    if (!p) {
      p = fetch(src)
        .then(async (res) => (res.ok ? URL.createObjectURL(await res.blob()) : null))
        .catch(() => null);
      blobs.set(src, p);
    }
    void p.then((url) => {
      if (url && img.getAttribute('src') === src) img.setAttribute('src', url);
    });
  };
  const scan = (root: ParentNode) => root.querySelectorAll('img').forEach(fix);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes' && r.target instanceof HTMLImageElement) fix(r.target);
      r.addedNodes.forEach((n) => {
        if (n instanceof HTMLImageElement) fix(n);
        else if (n instanceof Element) scan(n);
      });
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
  scan(document);
}
