import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { purgeIdempotencyKeys } from '../src/lib/idempotency';
import { isTransientDbError } from '../src/lib/http';
import { BASE, addFamily, call, dog, fakeJpeg, givePoints, passphrase, registerUser } from './helpers';

// 電波が弱い場所でも動くための仕組み(要件定義書 15.3): 送信の印・押した時刻・HTTP の保存・大きさの上限

const PAPA = 'U001:パパ';
const MAMA = 'U002:ママ';
const NOW = '2026-10-30T01:00:00Z'; // 日本時間 10:00
const KEY_A = '0b0f6c1e-1111-4a4a-8888-000000000001';
const KEY_B = '0b0f6c1e-1111-4a4a-8888-000000000002';

const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())!.n;

async function checkinWithKey(user: string, dogIds: number[], key: string, extra: { now?: string; body?: object; headers?: Record<string, string> } = {}) {
  return call('/api/checkins', {
    user,
    now: extra.now ?? NOW,
    headers: { 'idempotency-key': key, ...extra.headers },
    body: { passphrase: await passphrase(), dogIds, ...extra.body },
  });
}

describe('送信の印(Idempotency-Key)でチェックインが二重にならない', () => {
  it('同じ印で2回送っても、チェックインは1回・ポイントは1。2回目は1回目と同じ応答を返す', async () => {
    const r = await registerUser(PAPA, [dog('アル')]);
    const first = await checkinWithKey(PAPA, [r.dogs[0]!.id], KEY_A);
    expect(first.status).toBe(201);
    const second = await checkinWithKey(PAPA, [r.dogs[0]!.id], KEY_A);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await count('SELECT COUNT(*) AS n FROM visits')).toBe(1);
    expect(await count('SELECT COALESCE(SUM(delta), 0) AS n FROM point_ledger')).toBe(1);
  });

  it('2回目の応答には「送り直し」の印(idempotent-replayed)が付く', async () => {
    const r = await registerUser(PAPA, [dog('アル')]);
    await checkinWithKey(PAPA, [r.dogs[0]!.id], KEY_A);
    const res = await SELF.fetch(`${BASE}/api/checkins`, {
      method: 'POST',
      headers: {
        authorization: `Bearer mock:U001:${encodeURIComponent('パパ')}`,
        'content-type': 'application/json',
        'idempotency-key': KEY_A,
        'x-debug-now': NOW,
      },
      body: JSON.stringify({ passphrase: await passphrase(), dogIds: [r.dogs[0]!.id] }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('idempotent-replayed')).toBe('true');
  });

  it('同じ日に別の印で送ると、これまでどおり「チェックイン済み」(409)', async () => {
    const r = await registerUser(PAPA, [dog('アル')]);
    expect((await checkinWithKey(PAPA, [r.dogs[0]!.id], KEY_A)).status).toBe(201);
    const other = await checkinWithKey(PAPA, [r.dogs[0]!.id], KEY_B);
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('already_checked_in');
    expect(await count('SELECT COALESCE(SUM(delta), 0) AS n FROM point_ledger')).toBe(1);
  });

  it('同じ印を同時に送っても、チェックインは1回だけ(もう一方は同じ応答か「処理しています」)', async () => {
    const r = await registerUser(PAPA, [dog('アル')]);
    const results = await Promise.all([1, 2, 3].map(() => checkinWithKey(PAPA, [r.dogs[0]!.id], KEY_A)));
    const ok = results.filter((x) => x.status === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const x of results) {
      if (x.status === 201) expect(x.body).toEqual(ok[0]!.body);
      else expect(x.body.error.code).toBe('request_in_progress');
    }
    expect(await count('SELECT COUNT(*) AS n FROM visits')).toBe(1);
    expect(await count('SELECT COALESCE(SUM(delta), 0) AS n FROM point_ledger')).toBe(1);
  });

  it('家族2人が別の印で同時に押しても、チェックインは1回(一意の索引)', async () => {
    const r = await registerUser(PAPA, [dog('アル')]);
    await addFamily(r.memberNo, 'U002', 'ママ');
    const [a, b] = await Promise.all([
      checkinWithKey(PAPA, [r.dogs[0]!.id], KEY_A),
      checkinWithKey(MAMA, [r.dogs[0]!.id], KEY_B),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await count('SELECT COUNT(*) AS n FROM visits')).toBe(1);
  });

  it('印は人ごと。ほかの人が同じ印を使っても、その人の送信として処理する', async () => {
    const papa = await registerUser(PAPA, [dog('アル')]);
    const mama = await registerUser(MAMA, [dog('ニコ')]);
    expect((await checkinWithKey(PAPA, [papa.dogs[0]!.id], KEY_A)).status).toBe(201);
    const res = await checkinWithKey(MAMA, [mama.dogs[0]!.id], KEY_A);
    expect(res.status).toBe(201);
    expect(await count('SELECT COUNT(*) AS n FROM visits')).toBe(2);
  });

  it('同じ印で中身が違う送信は 422(受け付けない)', async () => {
    const r = await registerUser(PAPA, [dog('アル'), dog('ニコ')]);
    expect((await checkinWithKey(PAPA, [r.dogs[0]!.id], KEY_A)).status).toBe(201);
    const res = await checkinWithKey(PAPA, [r.dogs[1]!.id], KEY_A);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('idempotency_mismatch');
    expect(res.body.error.message).toMatch(/画面を読み込み直して/);
  });

  it('「チェックイン済み」などのお知らせも保存し、同じ印なら同じお知らせを返す', async () => {
    const r = await registerUser(PAPA, [dog('アル')]);
    await checkinWithKey(PAPA, [r.dogs[0]!.id], KEY_A);
    const first = await checkinWithKey(PAPA, [r.dogs[0]!.id], KEY_B);
    const again = await checkinWithKey(PAPA, [r.dogs[0]!.id], KEY_B);
    expect(again).toEqual(first);
  });

  it('処理中のまま止まった印(60秒より前)は、送り直しで引き継いで処理する', async () => {
    const r = await registerUser(PAPA, [dog('アル')]);
    const { userHashOf } = await import('../src/lib/idempotency');
    // 1回目が途中で止まった(処理中のまま)ことにする。中身のハッシュは一致させる必要があるため、
    // まず同じ中身を別の印で通して保存された request_hash を写す
    await checkinWithKey(PAPA, [r.dogs[0]!.id], KEY_B, { now: '2026-10-29T01:00:00Z' });
    const hash = (await env.DB.prepare('SELECT request_hash FROM idempotency_keys WHERE key = ?').bind(KEY_B).first<{ request_hash: string }>())!.request_hash;
    await env.DB.prepare(
      `INSERT INTO idempotency_keys (user_hash, key, method, path, request_hash, state, created_at, updated_at)
       VALUES (?, ?, 'POST', '/api/checkins', ?, 'processing', '2026-10-30T09:59:00+09:00', '2000-01-01T00:00:00.000Z')`,
    )
      .bind(await userHashOf('U001'), KEY_A, hash)
      .run();
    const res = await checkinWithKey(PAPA, [r.dogs[0]!.id], KEY_A);
    expect(res.status).toBe(201);
  });

  it('処理中の印(まだ新しい)への送り直しは 409「処理しています」', async () => {
    const r = await registerUser(PAPA, [dog('アル')]);
    const { userHashOf } = await import('../src/lib/idempotency');
    await checkinWithKey(PAPA, [r.dogs[0]!.id], KEY_B, { now: '2026-10-29T01:00:00Z' });
    const hash = (await env.DB.prepare('SELECT request_hash FROM idempotency_keys WHERE key = ?').bind(KEY_B).first<{ request_hash: string }>())!.request_hash;
    await env.DB.prepare(
      `INSERT INTO idempotency_keys (user_hash, key, method, path, request_hash, state, created_at, updated_at)
       VALUES (?, ?, 'POST', '/api/checkins', ?, 'processing', '2026-10-30T09:59:00+09:00', ?)`,
    )
      .bind(await userHashOf('U001'), KEY_A, hash, new Date().toISOString())
      .run();
    const res = await checkinWithKey(PAPA, [r.dogs[0]!.id], KEY_A);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('request_in_progress');
    expect(res.body.error.message).toMatch(/少し待ってから/);
  });

  it('印の形が違うときは 400。印のない送信は、これまでどおり処理する', async () => {
    const r = await registerUser(PAPA, [dog('アル')]);
    const bad = await checkinWithKey(PAPA, [r.dogs[0]!.id], 'x y');
    expect(bad.status).toBe(400);
    const plain = await call('/api/checkins', { user: PAPA, now: NOW, body: { passphrase: await passphrase(), dogIds: [r.dogs[0]!.id] } });
    expect(plain.status).toBe(201);
  });

  it('LINE のユーザーID は、そのままではなくハッシュで残す', async () => {
    const r = await registerUser(PAPA, [dog('アル')]);
    await checkinWithKey(PAPA, [r.dogs[0]!.id], KEY_A);
    const row = await env.DB.prepare('SELECT user_hash FROM idempotency_keys').first<{ user_hash: string }>();
    expect(row!.user_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(row!.user_hash).not.toContain('U001');
  });

  it('7日より古い印は夜間の処理で消える(業務の記録ではない)。新しい印は残る', async () => {
    const r = await registerUser(PAPA, [dog('アル')]);
    await checkinWithKey(PAPA, [r.dogs[0]!.id], KEY_A, { now: '2026-10-20T01:00:00Z' });
    await checkinWithKey(PAPA, [r.dogs[0]!.id], KEY_B, { now: '2026-10-29T01:00:00Z' });
    const removed = await purgeIdempotencyKeys(env.DB, new Date('2026-10-30T03:10:00+09:00'));
    expect(removed).toBe(1);
    const { results } = await env.DB.prepare('SELECT key FROM idempotency_keys').all<{ key: string }>();
    expect(results.map((x) => x.key)).toEqual([KEY_B]);
    // 来場とポイントの記録はそのまま
    expect(await count('SELECT COUNT(*) AS n FROM visits')).toBe(2);
  });
});

describe('送信の印: 無料券とワンちゃん', () => {
  it('無料券の使用を同じ印で2回送っても、使うのは1回。2回目も「使用できました」の内容を返す', async () => {
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 10);
    const ex = await call('/api/tickets/exchange', { user: PAPA, now: NOW, body: {}, headers: { 'idempotency-key': KEY_A } });
    expect(ex.status).toBe(201);
    const ex2 = await call('/api/tickets/exchange', { user: PAPA, now: NOW, body: {}, headers: { 'idempotency-key': KEY_A } });
    expect(ex2.body.ticketId).toBe(ex.body.ticketId);
    expect(await count('SELECT COUNT(*) AS n FROM tickets')).toBe(1);

    const use1 = await call(`/api/tickets/${ex.body.ticketId}/use`, { user: PAPA, now: NOW, body: {}, headers: { 'idempotency-key': KEY_B } });
    const use2 = await call(`/api/tickets/${ex.body.ticketId}/use`, { user: PAPA, now: NOW, body: {}, headers: { 'idempotency-key': KEY_B } });
    expect(use1.status).toBe(200);
    expect(use2.status).toBe(200);
    expect(use2.body).toEqual(use1.body);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ticket.use'")).toBe(1);
  });

  it('ワンちゃんの追加を同じ印で2回送っても、1頭だけ増える', async () => {
    await registerUser(PAPA, [dog('アル')]);
    const add = () => call('/api/dogs', { user: PAPA, now: NOW, body: dog('ニコ'), headers: { 'idempotency-key': KEY_A } });
    const a = await add();
    const b = await add();
    expect(a.status).toBe(201);
    expect(b.body).toEqual(a.body);
    expect(await count("SELECT COUNT(*) AS n FROM dogs WHERE name = 'ニコ'")).toBe(1);
  });

  it('写真の送信(multipart)にも印が効く', async () => {
    const r = await registerUser(PAPA, [dog('アル')]);
    const form = () => {
      const f = new FormData();
      f.append('photo', new File([fakeJpeg(800, 600)], 'p.jpg', { type: 'image/jpeg' }));
      f.append('thumb', new File([fakeJpeg(240, 240)], 't.jpg', { type: 'image/jpeg' }));
      return f;
    };
    const a = await call(`/api/dogs/${r.dogs[0]!.id}/photo`, { user: PAPA, now: NOW, body: form(), headers: { 'idempotency-key': KEY_A } });
    expect(a.status).toBe(200);
    const b = await call(`/api/dogs/${r.dogs[0]!.id}/photo`, { user: PAPA, now: NOW, body: form(), headers: { 'idempotency-key': KEY_A } });
    expect(b.body).toEqual(a.body);
    expect(await count("SELECT COUNT(*) AS n FROM dog_changes WHERE field = 'photo'")).toBe(1);
  });
});

describe('押した時刻(電波が弱く、送信が遅れたとき)', () => {
  it('押してから10分後に届いたときは、押した時刻(サーバーの時刻から10分前)をチェックインの時刻にする', async () => {
    const r = await registerUser(PAPA, [dog('アル')]);
    const pressedAt = 1_700_000_000_000;
    const res = await checkinWithKey(PAPA, [r.dogs[0]!.id], KEY_A, {
      body: { pressedAt },
      headers: { 'x-client-now': String(pressedAt + 10 * 60_000) },
    });
    expect(res.status).toBe(201);
    const v = await env.DB.prepare('SELECT visit_date, checked_in_at FROM visits').first();
    expect(v).toEqual({ visit_date: '2026-10-30', checked_in_at: '2026-10-30T09:50:00+09:00' });
  });

  it('30分を超えて遅れたときは、サーバーの時刻', async () => {
    const r = await registerUser(PAPA, [dog('アル')]);
    const pressedAt = 1_700_000_000_000;
    await checkinWithKey(PAPA, [r.dogs[0]!.id], KEY_A, {
      body: { pressedAt },
      headers: { 'x-client-now': String(pressedAt + 31 * 60_000) },
    });
    const v = await env.DB.prepare('SELECT checked_in_at FROM visits').first();
    expect(v).toEqual({ checked_in_at: '2026-10-30T10:00:00+09:00' });
  });

  it('日本時間の0時をまたいだときは、サーバーの時刻(日付はサーバーの今日)', async () => {
    const r = await registerUser(PAPA, [dog('アル')]);
    const pressedAt = 1_700_000_000_000;
    await checkinWithKey(PAPA, [r.dogs[0]!.id], KEY_A, {
      now: '2026-10-29T15:03:00Z', // 日本時間 10/30 0:03
      body: { pressedAt },
      headers: { 'x-client-now': String(pressedAt + 10 * 60_000) },
    });
    const v = await env.DB.prepare('SELECT visit_date, checked_in_at FROM visits').first();
    expect(v).toEqual({ visit_date: '2026-10-30', checked_in_at: '2026-10-30T00:03:00+09:00' });
  });

  it('送った時刻のヘッダーがないときは、サーバーの時刻', async () => {
    const r = await registerUser(PAPA, [dog('アル')]);
    await checkinWithKey(PAPA, [r.dogs[0]!.id], KEY_A, { body: { pressedAt: 1_700_000_000_000 } });
    const v = await env.DB.prepare('SELECT checked_in_at FROM visits').first();
    expect(v).toEqual({ checked_in_at: '2026-10-30T10:00:00+09:00' });
  });

  it('押した時刻が数でなければ 400', async () => {
    const r = await registerUser(PAPA, [dog('アル')]);
    const res = await checkinWithKey(PAPA, [r.dogs[0]!.id], KEY_A, { body: { pressedAt: 'きのう' } });
    expect(res.status).toBe(400);
  });
});

describe('少ない通信で済むための HTTP の決まり', () => {
  const headersOf = (user: string) => ({ authorization: `Bearer mock:${user.split(':')[0]}:x`, 'x-debug-now': NOW });

  it('読み込み(GET)は ETag つきで、変わっていなければ 304(本文なし)', async () => {
    await registerUser(PAPA, [dog('アル')]);
    const first = await SELF.fetch(`${BASE}/api/dogs`, { headers: headersOf(PAPA) });
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('private, no-cache');
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^W\/"[0-9a-f]+"$/);
    await first.text();
    const again = await SELF.fetch(`${BASE}/api/dogs`, { headers: { ...headersOf(PAPA), 'if-none-match': etag! } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
    // 中身が変わったら 200
    await call('/api/dogs', { user: PAPA, now: NOW, body: dog('ニコ') });
    const changed = await SELF.fetch(`${BASE}/api/dogs`, { headers: { ...headersOf(PAPA), 'if-none-match': etag! } });
    expect(changed.status).toBe(200);
  });

  it('ほかの人の ETag では 304 にならない(中身が違う)', async () => {
    await registerUser(PAPA, [dog('アル')]);
    await registerUser(MAMA, [dog('ニコ')]);
    const papa = await SELF.fetch(`${BASE}/api/me`, { headers: headersOf(PAPA) });
    const etag = papa.headers.get('etag')!;
    const mama = await SELF.fetch(`${BASE}/api/me`, { headers: { ...headersOf(MAMA), 'if-none-match': etag } });
    expect(mama.status).toBe(200);
  });

  it('大きな JSON は gzip で圧縮して返す', async () => {
    const res = await SELF.fetch(`${BASE}/api/breeds`, { headers: { ...headersOf(PAPA), 'accept-encoding': 'gzip' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('gzip');
    // 圧縮は1回だけ(受け取った側で1回ほどけば JSON として読める)
    const body = (await res.json()) as { breeds: unknown[] };
    expect(body.breeds.length).toBeGreaterThan(0);
  });

  it('写真は認証つきのまま、スマホの中に長く保存させ(private・immutable)、ETag で 304 を返す', async () => {
    const r = await registerUser(PAPA, [dog('アル')]);
    const f = new FormData();
    f.append('photo', new File([fakeJpeg(800, 600)], 'p.jpg', { type: 'image/jpeg' }));
    f.append('thumb', new File([fakeJpeg(240, 240)], 't.jpg', { type: 'image/jpeg' }));
    const up = await call(`/api/dogs/${r.dogs[0]!.id}/photo`, { user: PAPA, now: NOW, body: f });
    const thumbUrl = up.body.dog.thumbUrl as string;
    const res = await SELF.fetch(`${BASE}${thumbUrl}`, { headers: headersOf(PAPA) });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    const etag = res.headers.get('etag')!;
    await res.arrayBuffer();
    const again = await SELF.fetch(`${BASE}${thumbUrl}`, { headers: { ...headersOf(PAPA), 'if-none-match': etag } });
    expect(again.status).toBe(304);
    // 認証がなければ見られない。ETag を知っていても、ほかのおうちには見せない
    expect((await SELF.fetch(`${BASE}${thumbUrl}`)).status).toBe(401);
    await registerUser(MAMA, [dog('ニコ')]);
    const other = await SELF.fetch(`${BASE}${thumbUrl}`, { headers: { ...headersOf(MAMA), 'if-none-match': etag } });
    expect(other.status).toBe(404);
  });

  it('送る内容が大きすぎるときは 413(JSON は 64KB まで)', async () => {
    await registerUser(PAPA, [dog('アル')]);
    const res = await call('/api/checkins', { user: PAPA, now: NOW, body: { passphrase: 'x'.repeat(70 * 1024), dogIds: [1] } });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('too_large');
    expect(res.body.error.message).toMatch(/大きすぎます/);
  });
});

describe('データベースの一時的な不調', () => {
  it('混雑・接続の切れは一時的な不調とみなし、一意の索引の違反や SQL の誤りは含めない', () => {
    expect(isTransientDbError(new Error('D1_ERROR: Network connection lost.'))).toBe(true);
    expect(isTransientDbError(new Error('D1 DB is overloaded. Requests queued for too long.'))).toBe(true);
    expect(isTransientDbError(new Error('D1_ERROR: UNIQUE constraint failed: visits.household_id'))).toBe(false);
    expect(isTransientDbError(new Error('D1_ERROR: no such table: foo'))).toBe(false);
    expect(isTransientDbError(new Error('something else'))).toBe(false);
  });
});
