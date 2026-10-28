import { getIdToken } from './liff';

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

/** お客さん向け API を呼ぶ。毎回 LINE の IDトークンを付ける。 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${getIdToken()}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(0, 'network', '通信できませんでした。電波のよい場所で、もう一度お試しください。');
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

export const postJson = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const patchJson = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
