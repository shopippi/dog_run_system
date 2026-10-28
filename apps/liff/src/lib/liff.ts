import liff from '@line/liff';

// LIFF SDK のうち、このアプリで使う部分だけをまとめる。
// VITE_LIFF_ID がないとき(開発・Playwright のテスト)はモックで動く。
// モックのユーザーは URL の ?mockUser=U001:パパ か、前回のモックユーザーを使う。

const LIFF_ID = import.meta.env.VITE_LIFF_ID ?? '';
export const isMock = LIFF_ID === '';

const MOCK_KEY = 'dr.mockUser';

function mockUser(): { userId: string; name: string } {
  const fromUrl = new URLSearchParams(location.search).get('mockUser');
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
  return !isMock && liff.isApiAvailable('scanCodeV2');
}

/** 招待の URL。LINE の中で開くと、LIFF の招待の画面(L-12)になる。 */
export function inviteUrl(code: string): string {
  return isMock ? `${location.origin}/liff/invite/${code}` : `https://liff.line.me/${LIFF_ID}/invite/${code}`;
}
