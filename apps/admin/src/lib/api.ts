export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/**
 * 管理画面向け API を呼ぶ。ログインはクッキーで保つ(同じドメインから配信しているため)。
 * 変更系の操作には x-dr-admin ヘッダーを付け、ほかのサイトからの送信と区別する。
 */
export async function adminApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('x-dr-admin', '1');
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  let res: Response;
  try {
    res = await fetch(`/admin/api${path}`, { ...init, headers, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network', 'インターネットにつながっていないようです。接続を確かめて、もう一度お試しください。');
  }
  if (!res.ok) {
    let body: { error?: { code?: string; message?: string; details?: Record<string, unknown> } } = {};
    try {
      body = await res.json();
    } catch {
      // 本文がなくてもよい
    }
    throw new ApiError(
      res.status,
      body.error?.code ?? 'unknown',
      body.error?.message ?? 'うまく処理できませんでした。少し待ってから、もう一度お試しください。',
      body.error?.details,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const adminPost = <T>(path: string, body: unknown = {}) =>
  adminApi<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const adminPatch = <T>(path: string, body: unknown) =>
  adminApi<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
