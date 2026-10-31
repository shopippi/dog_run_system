// LIFF SDK のうち、このアプリで使う部分だけを読み込む(pluggable SDK。全部入りより小さく、電波が弱くても早く開く)。
// VITE_LIFF_ID がないとき(開発・Playwright のテスト)はモックで動く。
// モックのユーザーは URL の ?mockUser=U001:パパ か、前回のモックユーザーを使う。
import liff from '@line/liff/core';
import CloseWindow from '@line/liff/close-window';
import GetDecodedIDToken from '@line/liff/get-decoded-id-token';
import GetIDToken from '@line/liff/get-id-token';
import IsApiAvailable from '@line/liff/is-api-available';
import IsInClient from '@line/liff/is-in-client';
import IsLoggedIn from '@line/liff/is-logged-in';
import Login from '@line/liff/login';
import ScanCodeV2 from '@line/liff/scan-code-v2';
import ShareTargetPicker from '@line/liff/share-target-picker';

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

let installed = false;
function installModules() {
  if (installed) return;
  installed = true;
  liff.use(new IsInClient());
  liff.use(new IsLoggedIn());
  liff.use(new Login());
  liff.use(new GetIDToken());
  liff.use(new GetDecodedIDToken());
  liff.use(new IsApiAvailable());
  liff.use(new CloseWindow());
  liff.use(new ScanCodeV2());
  liff.use(new ShareTargetPicker());
}

/** LIFF の準備。電波が弱く、決まった時間で終わらないときは失敗にする(画面に「もう一度読み込む」を出す) */
export async function initLiff(timeoutMs = 20_000): Promise<void> {
  if (isMock) return;
  installModules();
  let timer = 0;
  await Promise.race([
    liff.init({ liffId: LIFF_ID }),
    new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error('liff init timeout')), timeoutMs);
    }),
  ]).finally(() => window.clearTimeout(timer));
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

/** IDトークンの期限が切れている(あと1分を切った)か。モックでは切れない */
export function idTokenExpired(): boolean {
  if (isMock) return false;
  const exp = liff.getDecodedIDToken()?.exp;
  return typeof exp === 'number' && exp * 1000 < Date.now() + 60_000;
}

const RELOGIN_KEY = 'dr.relogin';

/**
 * LINE のログインをやり直す(IDトークンの期限が切れたとき)。LINE の中では画面が一度読み込み直され、新しいトークンで戻る。
 * 送信待ちのチェックインは端末に保存してあるので、戻ったあとに自動で送る。
 * 1分以内に2回はやり直さない(やり直しがくり返されるのを防ぐ)。やり直せないときは false。
 */
export function relogin(): boolean {
  if (isMock) return false;
  try {
    const last = Number(sessionStorage.getItem(RELOGIN_KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(RELOGIN_KEY, String(Date.now()));
  } catch {
    // 覚えられない端末でも、やり直しはする
  }
  liff.login({ redirectUri: location.href });
  return true;
}

/**
 * いま開いている LINE ユーザーを表す短い印(端末に保存する会員証を、人ごとに分けるため)。
 * LINE のユーザーID そのものは保存せず、ハッシュにする。分からないときは null。
 */
export function currentUserKey(): string | null {
  let id: string | undefined;
  if (isMock) id = mockUser().userId;
  else {
    try {
      id = liff.getDecodedIDToken()?.sub;
    } catch {
      id = undefined;
    }
  }
  if (!id) return null;
  // FNV-1a(32bit)を2回。暗号ではなく、ID をそのまま残さないための印
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
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
