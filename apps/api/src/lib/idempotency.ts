import { IDEMPOTENCY_KEY_RE, IDEMPOTENCY_RETENTION_DAYS, addDays, toJstDate, toJstIso } from '@dr/shared';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';
import { AppError, errors } from './errors';

// 送信の印(Idempotency-Key)。電波が弱く、同じ送信が2回以上届いても、1回だけ処理する(要件定義書 15.3)。
//
// - 画面は、変更の送信(POST・PATCH・PUT・DELETE)ごとに UUID を作り、Idempotency-Key ヘッダーに入れる。
//   送り直すときは同じ印を使う。
// - サーバーは、同じ人(LINE ユーザー)の同じ印を同じ送信とみなす。1回目の応答(成功も、「チェックイン済み」などの
//   お知らせも)を保存し、2回目からはそれをそのまま返す(ヘッダー idempotent-replayed: true)。ポイントは二重に付かない。
// - 1回目がまだ処理中なら 409(request_in_progress)。画面は少し待って同じ印で送り直す。
// - サーバー側の一時的な失敗(500 番台)は保存しない。同じ印で送り直すと、もう一度処理する。
// - 同じ印で中身が違う送信は受け付けない(422)。
// - 印のない送信は、これまでどおり処理する(印は任意)。

/** 処理中の印を、ほかの送信が引き継いでよくなるまでの時間(Worker が途中で止まったとき) */
const STALE_MS = 60_000;
/** 応答を保存する大きさの上限 */
const MAX_STORED = 256 * 1024;

const encoder = new TextEncoder();

async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** LINE のユーザーID を、そのままではなくハッシュで持つ */
export async function userHashOf(lineUserId: string): Promise<string> {
  return (await sha256Hex(encoder.encode(`line:${lineUserId}`))).slice(0, 32);
}

/**
 * 送った内容の指紋。multipart(写真)は送るたびに区切りの文字が変わるため、中身(項目の名前と値・ファイルの中身)から作る。
 * 読んだ内容は Hono が覚えておくので、このあとの処理でもう一度読める。
 */
async function requestFingerprint(
  type: string,
  method: string,
  path: string,
  c: { req: { arrayBuffer(): Promise<ArrayBuffer>; formData(): Promise<FormData> } },
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [encoder.encode(`${method} ${path}\n`)];
  if (type.startsWith('multipart/form-data')) {
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      form = new FormData();
    }
    for (const [name, value] of form.entries()) {
      parts.push(encoder.encode(`\n${name}=`));
      parts.push(typeof value === 'string' ? encoder.encode(value) : new Uint8Array(await value.arrayBuffer()));
    }
  } else {
    parts.push(new Uint8Array(await c.req.arrayBuffer()));
  }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return all;
}

type Row = {
  request_hash: string;
  state: 'processing' | 'done' | 'failed';
  status: number | null;
  response_body: string | null;
  updated_at: string;
};

const inProgress = () =>
  new AppError(409, 'request_in_progress', '前に送った内容を処理しています。少し待ってから、もう一度お試しください。');

/** お客さん向け API の変更の送信に付ける。requireLineUser のあとに置く */
export const idempotency = createMiddleware<AppEnv>(async (c, next) => {
  const method = c.req.method;
  const key = c.req.header('idempotency-key');
  if (!key || method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  if (!IDEMPOTENCY_KEY_RE.test(key)) {
    throw errors.badRequest('送った内容を確認できませんでした。画面を読み込み直して、もう一度お試しください。');
  }
  const db = c.env.DB;
  const user = await userHashOf(c.get('lineUser').userId);
  const requestHash = await sha256Hex(await requestFingerprint(c.req.raw.headers.get('content-type') ?? '', method, c.req.path, c));
  // 処理中の印が古くなったかは、実際の時刻で判断する(テストの x-debug-now に左右されない)
  const realNow = new Date();
  const nowIso = toJstIso(c.get('now'));

  const claimed = await db
    .prepare(
      `INSERT INTO idempotency_keys (user_hash, key, method, path, request_hash, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'processing', ?, ?) ON CONFLICT (user_hash, key) DO NOTHING`,
    )
    .bind(user, key, method, c.req.path, requestHash, nowIso, realNow.toISOString())
    .run();

  if (claimed.meta.changes !== 1) {
    const row = await db
      .prepare('SELECT request_hash, state, status, response_body, updated_at FROM idempotency_keys WHERE user_hash = ? AND key = ?')
      .bind(user, key)
      .first<Row>();
    if (!row) throw inProgress();
    if (row.request_hash !== requestHash) {
      throw new AppError(
        422,
        'idempotency_mismatch',
        '前に送った内容と違うため、受け付けませんでした。画面を読み込み直して、もう一度操作してください。',
      );
    }
    if (row.state === 'done' && row.status !== null) {
      return new Response(row.response_body, {
        status: row.status,
        headers: { 'content-type': 'application/json; charset=UTF-8', 'idempotent-replayed': 'true', 'cache-control': 'no-store' },
      });
    }
    const stale = realNow.getTime() - new Date(row.updated_at).getTime() > STALE_MS;
    if (row.state === 'processing' && !stale) throw inProgress();
    // やり直してよい(前回はサーバーの一時的な失敗、または途中で止まった)。同時に2つが引き継がないよう、条件つきで取る
    const retake = await db
      .prepare(
        `UPDATE idempotency_keys SET state = 'processing', updated_at = ?
          WHERE user_hash = ? AND key = ? AND state = ? AND updated_at = ?`,
      )
      .bind(realNow.toISOString(), user, key, row.state, row.updated_at)
      .run();
    if (retake.meta.changes !== 1) throw inProgress();
  }

  await next();

  // 応答を保存する。サーバーの一時的な失敗(500 番台)と、ログインの確認ができなかったときは保存せず、送り直せるようにする
  const res = c.res;
  const finish = async (state: 'done' | 'failed', status: number | null, text: string | null) => {
    await db
      .prepare(
        `UPDATE idempotency_keys SET state = ?, status = ?, response_body = ?, updated_at = ? WHERE user_hash = ? AND key = ?`,
      )
      .bind(state, status, text, new Date().toISOString(), user, key)
      .run();
  };
  try {
    const storable = res.status < 500 && res.status !== 401 && res.status !== 429;
    const type = res.headers.get('content-type') ?? '';
    const text = storable && (type.startsWith('application/json') || res.status === 204) ? await res.clone().text() : null;
    if (storable && text !== null && text.length <= MAX_STORED) await finish('done', res.status, text);
    else await finish('failed', null, null);
  } catch (e) {
    // 保存に失敗しても、処理の結果はそのまま返す(送り直されたら、二重チェックインの索引などが守る)
    console.error('idempotency: 応答を保存できませんでした', e);
  }
});

/** 古い送信の印を消す(夜間の処理)。業務の記録ではないため消してよい(要件定義書 15.3) */
export async function purgeIdempotencyKeys(db: D1Database, now: Date): Promise<number> {
  const before = `${addDays(toJstDate(now), -IDEMPOTENCY_RETENTION_DAYS)}T00:00:00+09:00`;
  const res = await db.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').bind(before).run();
  return res.meta.changes ?? 0;
}
