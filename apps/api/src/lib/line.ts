import type { Bindings, LineUser } from '../env';
import { AppError } from './errors';

/**
 * LINE の IDトークンを、LINE のサーバーに問い合わせて検証する(要件定義書 15.2)。
 * 開発とテストでは、"mock:<ユーザーID>:<表示名>" の形のモックトークンも受け付ける。
 * モックは ENVIRONMENT が local / test で、LINE_LOGIN_MOCK が "1" のときだけ有効。
 */
export async function verifyLineIdToken(env: Bindings, idToken: string): Promise<LineUser | null> {
  if (isMockEnabled(env) && idToken.startsWith('mock:')) {
    const [, userId, name] = idToken.split(':');
    if (!userId) return null;
    return { userId, displayName: decodeURIComponent(name ?? '') || 'テスト' };
  }

  let res: Response;
  try {
    res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: env.LINE_CHANNEL_ID }),
    });
  } catch {
    throw lineUnavailable();
  }
  if (res.status >= 500) throw lineUnavailable();
  if (!res.ok) return null;
  const body = (await res.json()) as { sub?: string; name?: string };
  if (!body.sub) return null;
  return { userId: body.sub, displayName: body.name ?? '' };
}

export function isMockEnabled(env: Bindings): boolean {
  return env.LINE_LOGIN_MOCK === '1' && (env.ENVIRONMENT === 'local' || env.ENVIRONMENT === 'test');
}

const lineUnavailable = () =>
  new AppError(503, 'line_unavailable', 'LINEとの通信がうまくいきませんでした。少し待ってから、もう一度開いてください。');
