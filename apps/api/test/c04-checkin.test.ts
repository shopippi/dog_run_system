import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { addFamily, call, checkin, dog, exchangeTicket, givePoints, registerUser, useTicketOf } from './helpers';

const PAPA = 'U001:パパ';
const MAMA = 'U002:ママ';
const DAY1 = '2026-10-28T01:00:00Z'; // 日本時間 10:00
const DAY2 = '2026-10-29T01:00:00Z';

const ledger = async () =>
  (await env.DB.prepare('SELECT delta, kind FROM point_ledger ORDER BY id').all()).results;
const balance = async (user: string, now = DAY1) => (await call('/api/checkins/today', { user, now })).body.balance;

describe('C-04 チェックイン', () => {
  it('チェックインすると、来場と犬が記録され、1ポイント付く', async () => {
    const r = await registerUser(PAPA, [dog('アル'), dog('ニコ')]);
    const res = await checkin(PAPA, r.dogs.map((d) => d.id), { now: DAY1 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ visitId: expect.any(Number), pointsAwarded: 1, usedTicket: false, balanceAfter: 1 });

    const v = await env.DB.prepare('SELECT visit_date, checked_in_at, dog_count, method FROM visits').first();
    expect(v).toEqual({ visit_date: '2026-10-28', checked_in_at: '2026-10-28T10:00:00+09:00', dog_count: 2, method: 'self' });
    const dogs = await env.DB.prepare('SELECT COUNT(*) AS n FROM visit_dogs').first<{ n: number }>();
    expect(dogs?.n).toBe(2);
  });

  it('2頭で来ても付与は1ポイント', async () => {
    const r = await registerUser(PAPA, [dog('アル'), dog('ニコ')]);
    await checkin(PAPA, r.dogs.map((d) => d.id), { now: DAY1 });
    expect(await ledger()).toEqual([{ delta: 1, kind: 'visit' }]);
  });

  it('同じおうちの2回目のチェックインは、家族が別でもポイントが増えない(19.2)', async () => {
    const r = await registerUser(PAPA);
    await addFamily(r.memberNo, 'U002', 'ママ');
    expect((await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 })).status).toBe(201);

    const again = await checkin(MAMA, [r.dogs[0]!.id], { now: '2026-10-28T05:00:00Z' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_checked_in');
    expect(again.body.error.message).toMatch(/今日はパパさんがチェックイン済み/);
    expect(await balance(PAPA)).toBe(1);
  });

  it('日付は日本時間で判定する(日本時間の0時をまたげば別の日)', async () => {
    const r = await registerUser(PAPA);
    // 日本時間 10/28 23:59 と 10/29 0:00
    expect((await checkin(PAPA, [r.dogs[0]!.id], { now: '2026-10-28T14:59:00Z' })).status).toBe(201);
    expect((await checkin(PAPA, [r.dogs[0]!.id], { now: '2026-10-28T15:00:00Z' })).status).toBe(201);
    const { results } = await env.DB.prepare('SELECT visit_date FROM visits ORDER BY id').all();
    expect(results).toEqual([{ visit_date: '2026-10-28' }, { visit_date: '2026-10-29' }]);
  });

  it('同時に家族2人が押しても、チェックインは1回だけ', async () => {
    const r = await registerUser(PAPA);
    await addFamily(r.memberNo, 'U002', 'ママ');
    const [a, b] = await Promise.all([
      checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 }),
      checkin(MAMA, [r.dogs[0]!.id], { now: DAY1 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await ledger()).toEqual([{ delta: 1, kind: 'visit' }]);
  });

  it('9ポイントのおうちがチェックインすると10ポイントになる。無料券は自動では発行しない(8章)', async () => {
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 9);
    const res = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    expect(res.body).toMatchObject({ pointsAwarded: 1, balanceAfter: 10 });
    const status = await call('/api/checkins/today', { user: PAPA, now: DAY1 });
    expect(status.body).toMatchObject({ balance: 10, unusedTickets: 0 });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM tickets').first()).toEqual({ n: 0 });
    expect((await ledger()).slice(-1)).toEqual([{ delta: 1, kind: 'visit' }]);
    // さらに来ても、ポイントはたまり続ける
    expect((await checkin(PAPA, [r.dogs[0]!.id], { now: DAY2 })).body).toMatchObject({ balanceAfter: 11 });
  });

  it('その日に「使用する」で使った無料券は、チェックインした来場に結びつき、その日もポイントは付く(初期設定)', async () => {
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 10);
    expect((await exchangeTicket(PAPA, { now: DAY1 })).status).toBe(201);
    expect((await useTicketOf(PAPA, { now: DAY2 })).status).toBe(200);
    const res = await checkin(PAPA, [r.dogs[0]!.id], { now: '2026-10-29T02:00:00Z' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ usedTicket: true, pointsAwarded: 1, balanceAfter: 1 });
    const t = await env.DB.prepare('SELECT status, used_visit_id FROM tickets').first<{ status: string; used_visit_id: number }>();
    expect(t).toEqual({ status: 'used', used_visit_id: res.body.visitId });
    const today = await call('/api/checkins/today', { user: PAPA, now: '2026-10-29T03:00:00Z' });
    expect(today.body.visit).toMatchObject({ usedTicket: true });
  });

  it('設定で「無料券を使った日はポイントなし」にすると、その日に無料券を使ってからのチェックインには付かない', async () => {
    await env.DB.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES ('grant_point_on_ticket_day', 'false', '2026-01-01T00:00:00+09:00')",
    ).run();
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 10);
    await exchangeTicket(PAPA, { now: DAY1 });
    await useTicketOf(PAPA, { now: DAY2 });
    const res = await checkin(PAPA, [r.dogs[0]!.id], { now: '2026-10-29T02:00:00Z' });
    expect(res.body).toMatchObject({ pointsAwarded: 0, balanceAfter: 0, usedTicket: true });
  });

  it('チェックインで「無料券を使う」を送っても、無料券は使われない(チェックインでは選ばない)', async () => {
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 10);
    await exchangeTicket(PAPA, { now: DAY1 });
    const passphrase = JSON.parse(
      (await env.DB.prepare("SELECT value FROM settings WHERE key = 'checkin_passphrase'").first<{ value: string }>())!.value,
    );
    const res = await call('/api/checkins', { user: PAPA, now: DAY2, body: { passphrase, dogIds: [r.dogs[0]!.id], useTicket: true } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ usedTicket: false });
    expect(await env.DB.prepare('SELECT status FROM tickets').first()).toEqual({ status: 'unused' });
  });

  it('前の日に使った無料券は、次の日のチェックインには結びつかない', async () => {
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 10);
    await exchangeTicket(PAPA, { now: DAY1 });
    await useTicketOf(PAPA, { now: DAY1 });
    const res = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY2 });
    expect(res.body).toMatchObject({ usedTicket: false });
    expect(await env.DB.prepare('SELECT used_visit_id FROM tickets').first()).toEqual({ used_visit_id: null });
  });

  it('受付のQRコードの合言葉が違うとチェックインできない', async () => {
    const r = await registerUser(PAPA);
    const res = await call('/api/checkins', {
      user: PAPA,
      body: { passphrase: 'wrong', dogIds: [r.dogs[0]!.id] },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/QRコード/);
  });

  it('よそのおうちの犬や、おやすみ中の犬は選べない', async () => {
    const r = await registerUser(PAPA, [dog('アル'), dog('ニコ')]);
    const other = await registerUser('U900:よそ', [dog('ハナ')]);
    expect((await checkin(PAPA, [other.dogs[0]!.id], { now: DAY1 })).status).toBe(400);
    await call(`/api/dogs/${r.dogs[1]!.id}/retire`, { user: PAPA, method: 'POST' });
    expect((await checkin(PAPA, [r.dogs[1]!.id], { now: DAY1 })).status).toBe(400);
  });

  it('犬を1頭も選ばないとチェックインできない', async () => {
    await registerUser(PAPA);
    const res = await checkin(PAPA, [], { now: DAY1 });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/1頭以上/);
  });
});

describe('C-04 家族が同じ日に来たとき(5.5)', () => {
  it('チェックイン画面で、今日は誰がチェックイン済みかを返す', async () => {
    const r = await registerUser(PAPA, [dog('アル'), dog('ニコ')]);
    await addFamily(r.memberNo, 'U002', 'ママ');
    await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    const res = await call('/api/checkins/today', { user: MAMA, now: DAY1 });
    expect(res.body.visit).toMatchObject({ checkedInBy: 'パパ', isMe: false, dogIds: [r.dogs[0]!.id] });
    expect(res.body.today).toBe('2026-10-28');
  });

  it('一緒に来た犬を追加できる。ポイントは増えない', async () => {
    const r = await registerUser(PAPA, [dog('アル'), dog('ニコ')]);
    await addFamily(r.memberNo, 'U002', 'ママ');
    const first = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    const res = await call(`/api/checkins/${first.body.visitId}/dogs`, {
      user: MAMA,
      now: DAY1,
      body: { dogIds: [r.dogs[0]!.id, r.dogs[1]!.id] },
    });
    expect(res.status).toBe(200);
    expect(res.body.visit.dogIds).toEqual([r.dogs[0]!.id, r.dogs[1]!.id]);
    expect(await env.DB.prepare('SELECT dog_count FROM visits').first()).toEqual({ dog_count: 2 });
    expect(await ledger()).toEqual([{ delta: 1, kind: 'visit' }]);
  });

  it('前の日の来場や、よそのおうちの来場には追加できない', async () => {
    const r = await registerUser(PAPA);
    const first = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    const late = await call(`/api/checkins/${first.body.visitId}/dogs`, { user: PAPA, now: DAY2, body: { dogIds: [r.dogs[0]!.id] } });
    expect(late.status).toBe(409);
    const other = await registerUser('U900:よそ', [dog('ハナ')]);
    const res = await call(`/api/checkins/${first.body.visitId}/dogs`, { user: 'U900:よそ', now: DAY1, body: { dogIds: [other.dogs[0]!.id] } });
    expect(res.status).toBe(404);
  });
});
