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
