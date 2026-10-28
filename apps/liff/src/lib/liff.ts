import liff from '@line/liff';

// LIFF SDK のうち、このアプリで使う部分だけをまとめる。
// VITE_LIFF_ID がないとき(開発・Playwright のテスト)はモックで動く。
// モックのユーザーは URL の ?mockUser=U001:パパ か、前回のモックユーザーを使う。

const LIFF_ID = import.meta.env.VITE_LIFF_ID ?? '';
export const isMock = LIFF_ID === '';
/** ブラウザだけで動くデモ(apps/demo)の中で動いているか */
const isDemo = import.meta.env.VITE_DEMO === '1';

const MOCK_KEY = 'dr.mockUser';

/**
 * URL のクエリを読む。ハッシュで画面を切り替えるとき(#/checkin?mockUser=...)は、
 * location.search が空なので、ハッシュの「?」より後ろも見る。
 */
function queryParam(name: string): string | null {
  const fromSearch = new URLSearchParams(location.search).get(name);
  if (fromSearch || location.search) return fromSearch;
  const q = location.hash.indexOf('?');
  return q >= 0 ? new URLSearchParams(location.hash.slice(q + 1)).get(name) : null;
}

function mockUser(): { userId: string; name: string } {
  const fromUrl = queryParam('mockUser');
  let raw = fromUrl;
  if (!raw) {
    try {
      raw = localStorage.getItem(MOCK_KEY);
    } catch {
      raw = null;
    }
  }
  raw = raw || 'Umock0001:テストユーザー';
  try {
    localStorage.setItem(MOCK_KEY, raw);
  } catch {
    // 保存できなくても動く
  }
  const [userId, name] = raw.split(':');
  return { userId: userId || 'Umock0001', name: name || 'テストユーザー' };
}

export async function initLiff(): Promise<void> {
  if (isMock) return;
  await liff.init({ liffId: LIFF_ID });
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: location.href });
    // ログイン画面へ移動するので、ここから先は進まない
    await new Promise(() => {});
  }
}

export function getIdToken(): string {
  if (isMock) {
    const u = mockUser();
    return `mock:${u.userId}:${encodeURIComponent(u.name)}`;
  }
  const token = liff.getIDToken();
  if (!token) throw new Error('LINEのログイン情報を取得できませんでした');
  return token;
}

export function isInLineApp(): boolean {
  return isMock ? true : liff.isInClient();
}

export function liffId(): string {
  return LIFF_ID;
}

/** LINEのトークで友だちに送る。送れなかった・閉じたときは false。 */
export async function shareToLine(text: string): Promise<boolean> {
  if (isMock) {
    (window as unknown as { __sharedMessages?: string[] }).__sharedMessages ??= [];
    (window as unknown as { __sharedMessages: string[] }).__sharedMessages.push(text);
    // デモでは、親の画面の「LINE のトーク」に出す
    if (isDemo && window.parent !== window) window.parent.postMessage({ type: 'line-share', text }, demoOrigin());
    return true;
  }
  if (!liff.isApiAvailable('shareTargetPicker')) return false;
  const res = await liff.shareTargetPicker([{ type: 'text', text }]);
  return Boolean(res);
}

export function closeLiff(): void {
  if (!isMock && liff.isInClient()) liff.closeWindow();
}

/** LINE のカメラで受付のQRコードを読み取り、合言葉(k)を取り出す。読み取れなければ null。 */
export async function scanCheckinCode(): Promise<string | null> {
  if (isDemo) return extractPassphrase((await demoScan()) ?? '');
  if (isMock || !liff.isApiAvailable('scanCodeV2')) return null;
  const res = await liff.scanCodeV2();
  return extractPassphrase(res.value ?? '');
}

export function extractPassphrase(text: string): string | null {
  try {
    const url = new URL(text);
    const direct = url.searchParams.get('k');
    if (direct) return direct;
    // https://liff.line.me/<LIFF ID>/checkin?k=... は liff.state に入ることがある
    const state = url.searchParams.get('liff.state');
    if (state) return new URLSearchParams(state.split('?')[1] ?? '').get('k');
  } catch {
    // URL でなければ読み取れない
  }
  return null;
}

export function canScan(): boolean {
  if (isDemo) return window.parent !== window;
  return !isMock && liff.isApiAvailable('scanCodeV2');
}

const demoOrigin = () => (location.origin === 'null' ? '*' : location.origin);

/** デモでは、QR コードの読み取りを親の画面に頼む(受付の QR の URL が返る)。 */
function demoScan(): Promise<string | null> {
  if (window.parent === window) return Promise.resolve(null);
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; id?: string; value?: string | null };
      if (e.source !== window.parent || d?.type !== 'scan-result' || d.id !== id) return;
      window.removeEventListener('message', onMessage);
      resolve(d.value ?? null);
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'scan-request', id }, demoOrigin());
  });
}

/** 招待の URL。LINE の中で開くと、LIFF の招待の画面(L-12)になる。 */
export function inviteUrl(code: string): string {
  if (isDemo) return `https://liff.line.me/demo/invite/${code}`;
  return isMock ? `${location.origin}/liff/invite/${code}` : `https://liff.line.me/${LIFF_ID}/invite/${code}`;
}
