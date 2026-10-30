import { getIdToken, idTokenExpired, relogin } from './liff';
import { newId } from './storage';

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

// 電波が弱い場所でも、送信がなくならず、二重にもならないように(要件定義書 15.3):
// - 1回ごとに時間の上限を決め、届かなければ待ってから送り直す(だんだん間を空ける)
// - 変更の送信には、送信の印(Idempotency-Key)を付ける。送り直しでも同じ印を使うので、サーバーは1回だけ処理する
// - 送るたびに、その時点の LINE の IDトークンを付ける(期限が切れていたら、LINE のログインをやり直す)

export type ApiInit = RequestInit & {
  /** 送信の印。省くと、変更の送信ごとに新しく作る(送り直しのあいだは同じ印) */
  idempotencyKey?: string;
  /** 1回あたりの時間の上限(ミリ秒) */
  timeoutMs?: number;
  /** 送る回数の上限(1回目を含む) */
  attempts?: number;
};

const NETWORK_MESSAGE = '通信できませんでした。電波のよい場所で、もう一度お試しください。';
const TIMEOUT_MESSAGE = '通信に時間がかかっています。電波のよい場所で、もう一度お試しください。';
const SERVER_MESSAGE = 'うまく処理できませんでした。少し待ってから、もう一度お試しください。';
const RELOGIN_MESSAGE = 'LINEのログインの期限が切れました。画面を閉じて、もう一度開いてください。';

/** 送り直してよい失敗か(通信の失敗・時間切れ・サーバーの一時的な不調・前の送信の処理中) */
export function isRetryable(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  if (e.status === 0) return true;
  if (e.status === 502 || e.status === 503 || e.status === 504 || e.status === 429) return true;
  return e.status === 409 && e.code === 'request_in_progress';
}

/** 電波がない・届かなかった(画面で「送信を待っています」を出す) */
export function isOfflineError(e: unknown): boolean {
  return e instanceof ApiError && e.status === 0;
}

export const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/** つながるまで待つ(最大 ms)。つながっていればすぐ戻る */
export function waitForOnline(ms: number): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.onLine !== false) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener('online', done);
      window.clearTimeout(t);
      resolve();
    };
    const t = window.setTimeout(done, ms);
    window.addEventListener('online', done);
  });
}

/** 送り直すまでの待ち時間。0.6秒 → 1.5秒 → 3秒 → 6秒(少しばらつかせる) */
export function backoffMs(attempt: number): number {
  const base = [600, 1500, 3000, 6000][Math.min(Math.max(attempt, 1) - 1, 3)]!;
  return base + Math.floor(Math.random() * 250);
}

async function attemptOnce(path: string, init: ApiInit, key: string | undefined, timeoutMs: number): Promise<Response> {
  if (idTokenExpired()) {
    // 期限の切れたトークンでは、サーバーで確かめられない。LINE のログインをやり直す(画面が読み込み直される)
    if (relogin()) await new Promise(() => {});
    throw new ApiError(401, 'unauthorized', RELOGIN_MESSAGE);
  }
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${getIdToken()}`);
  // 送った時刻(スマホの時計)。押した時刻との差だけをサーバーが使う(チェックインの時刻。15.3)
  headers.set('x-client-now', String(Date.now()));
  if (key) headers.set('idempotency-key', key);
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const controller = new AbortController();
  const outer = init.signal;
  const onAbort = () => controller.abort();
  outer?.addEventListener('abort', onAbort);
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    // 写真の送信も同じ FormData を送り直せる(送るたびに組み立て直される)
    const { idempotencyKey: _k, timeoutMs: _t, attempts: _a, ...rest } = init;
    return await fetch(path, { ...rest, headers, signal: controller.signal });
  } catch {
    if (outer?.aborted) throw new DOMException('aborted', 'AbortError');
    throw new ApiError(0, timedOut ? 'timeout' : 'network', timedOut ? TIMEOUT_MESSAGE : NETWORK_MESSAGE);
  } finally {
    window.clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  }
}

async function toError(res: Response): Promise<ApiError> {
  let body: { error?: { code?: string; message?: string; details?: Record<string, unknown> } } = {};
  try {
    body = await res.json();
  } catch {
    // 本文がなくてもよい(途中の機器が返した 502 など)
  }
  return new ApiError(
    res.status,
    body.error?.code ?? (res.status >= 500 ? 'server' : 'unknown'),
    body.error?.message ?? SERVER_MESSAGE,
    body.error?.details,
  );
}

/**
 * お客さん向け API を呼ぶ。毎回 LINE の IDトークンを付ける。
 * 読み込み(GET)と、送信の印を付けた変更は、届かなかったときに自動で送り直す。
 */
export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const isRead = method === 'GET' || method === 'HEAD';
  const isForm = init.body instanceof FormData;
  const key = isRead ? undefined : (init.idempotencyKey ?? newId());
  const attempts = init.attempts ?? (isRead ? 3 : 4);
  // 写真は 400kbps でも送り切れるよう長めに。それ以外は 15 秒
  const timeoutMs = init.timeoutMs ?? (isForm ? 90_000 : 15_000);
  let reloginTried = false;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await attemptOnce(path, init, key, timeoutMs);
      if (res.status === 401 && !reloginTried) {
        // トークンの期限切れなど。LINE のログインをやり直す(戻ったら、保存してある送信待ちを送る)
        reloginTried = true;
        if (relogin()) await new Promise(() => {});
      }
      if (!res.ok) throw await toError(res);
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    } catch (e) {
      if (attempt >= attempts || !isRetryable(e)) throw e;
      await waitForOnline(8_000);
      await sleep(backoffMs(attempt));
    }
  }
}

export const postJson = <T>(path: string, body: unknown, init: ApiInit = {}) =>
  api<T>(path, { ...init, method: 'POST', body: JSON.stringify(body) });

export const patchJson = <T>(path: string, body: unknown, init: ApiInit = {}) =>
  api<T>(path, { ...init, method: 'PATCH', body: JSON.stringify(body) });
