import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';
import { AppError } from './errors';

// 電波が弱い場所でも少ない通信で動くための、HTTP の決まり(要件定義書 15.3)。

/** 写真を送る API(multipart)の上限。犬の写真 1MB + 一覧用 200KB、会員証の背景 2MB に余裕を足す */
const UPLOAD_LIMIT = 4 * 1024 * 1024;
/** それ以外(JSON)の上限 */
const JSON_LIMIT = 64 * 1024;

const tooLarge = () =>
  new AppError(413, 'too_large', '送った内容が大きすぎます。写真なら、別の写真を選び直してください。それ以外なら、画面を読み込み直してください。');

const uploadLimit = bodyLimit({ maxSize: UPLOAD_LIMIT, onError: () => { throw tooLarge(); } });
const jsonLimit = bodyLimit({ maxSize: JSON_LIMIT, onError: () => { throw tooLarge(); } });

/** お客さん向け API の、送られる内容の大きさの上限 */
export const customerBodyLimit = createMiddleware<AppEnv>(async (c, next) => {
  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD') return next();
  const type = c.req.header('content-type') ?? '';
  return (type.startsWith('multipart/form-data') ? uploadLimit : jsonLimit)(c, next);
});

/**
 * API の JSON を gzip で返す(1KB 以上のとき)。圧縮そのものは Workers の実行環境が行う:
 * Content-Encoding を付けた応答は、実行環境が本文を圧縮して送る(JavaScript で圧縮すると二重になるため、自分では圧縮しない)。
 * ブラウザだけで動くデモでは、ヘッダーが付くだけで本文はそのまま読める。
 */
export const gzipJson = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  const res = c.res;
  if (res.status === 204 || res.status === 304 || !res.body || res.headers.has('content-encoding')) return;
  if (!(res.headers.get('content-type') ?? '').startsWith('application/json')) return;
  if (!/\bgzip\b/i.test(c.req.header('accept-encoding') ?? '')) return;
  const len = Number(res.headers.get('content-length') ?? NaN);
  if (Number.isFinite(len) && len < 1024) return;
  const headers = new Headers(res.headers);
  headers.set('content-encoding', 'gzip');
  headers.delete('content-length');
  headers.append('vary', 'Accept-Encoding');
  c.res = new Response(res.body, { status: res.status, headers });
});

async function etagOf(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  const hex = [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `W/"${hex}"`;
}

/** If-None-Match に、その ETag が入っているか(弱い比較) */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const strip = (t: string) => t.trim().replace(/^W\//, '');
  const want = strip(etag);
  return header.split(',').some((t) => t.trim() === '*' || strip(t) === want);
}

/**
 * 読み込み(GET)の JSON に ETag をつけ、毎回サーバーに確かめる(private, no-cache)。
 * 中身が変わっていなければ 304 を返し、本文を送らない(会員証・ワンちゃん・設定など、あまり変わらない内容で効く)。
 * ブラウザの中だけに保存させ(private)、LINE のユーザーが変わっても中身が同じときしか 304 にならない。
 * 写真(/api/media)は、自分で ETag と長い保存期間をつけるため、ここでは触らない。
 */
export const privateRevalidate = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  if (c.req.method !== 'GET' || c.res.status !== 200) return;
  const type = c.res.headers.get('content-type') ?? '';
  if (!type.startsWith('application/json') || c.res.headers.has('cache-control')) return;
  const text = await c.res.clone().text();
  const etag = await etagOf(text);
  const headers = new Headers(c.res.headers);
  headers.set('etag', etag);
  headers.set('cache-control', 'private, no-cache');
  headers.append('vary', 'Authorization');
  if (etagMatches(c.req.header('if-none-match'), etag)) {
    headers.delete('content-type');
    headers.delete('content-length');
    c.res = new Response(null, { status: 304, headers });
    return;
  }
  headers.set('content-length', String(new TextEncoder().encode(text).byteLength));
  c.res = new Response(text, { status: 200, headers });
});

/**
 * データベース(D1)の一時的な不調か。混雑・接続の切れ・入れ替え中など、少し待って送り直せば通るもの。
 * 一意の索引の違反(二重チェックインなど)や、SQL の書き間違いは含めない。
 */
export function isTransientDbError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  // 文の誤り・変数の数の上限(too many SQL variables)など、送り直しても通らないものは含めない
  if (/constraint|syntax error|no such (table|column)|too many SQL variables|SQLITE_ERROR|SQLITE_TOOBIG/i.test(msg)) return false;
  return /D1_ERROR|D1 DB|SQLITE_BUSY|database is locked|Network connection lost|object to be reset|transient|overloaded|timed? ?out/i.test(msg);
}
