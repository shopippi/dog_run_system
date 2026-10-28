import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { runScheduled } from '../src/cron';
import { blockNetwork } from './analytics-helpers';
import { call, checkin, dog, survey } from './helpers';

const PAPA = 'U001:パパ';
const MAMA = 'U002:ママ';

async function setRule(key: 'point_expiry' | 'ticket_expiry', value: unknown) {
  await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
    .bind(key, JSON.stringify(value), 'x')
    .run();
}
async function register(user: string, now: string) {
  const res = await call('/api/register', { user, now, body: { consent: true, dogs: [dog('アル')], survey: survey() } });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  const h = await env.DB.prepare('SELECT id FROM households WHERE member_no = ?').bind(res.body.memberNo).first<{ id: number }>();
  return { householdId: h!.id, dogId: res.body.dogs[0].id as number };
}
const nightly = (jstDate: string) => runScheduled('10 18 * * *', env, new Date(`${jstDate}T03:10:00+09:00`));
const balance = async (householdId: number) =>
  (await env.DB.prepare('SELECT COALESCE(SUM(delta), 0) AS n FROM point_ledger WHERE household_id = ?').bind(householdId).first<{ n: number }>())!.n;
const ticketStatuses = async (householdId: number) =>
  (await env.DB.prepare('SELECT status FROM tickets WHERE household_id = ? ORDER BY id').bind(householdId).all<{ status: string }>()).results.map(
    (r) => r.status,
  );
async function ledger(householdId: number, delta: number, kind: string, expiresAt: string | null) {
  await env.DB.prepare(
    `INSERT INTO point_ledger (household_id, delta, kind, actor_type, created_at, expires_at) VALUES (?, ?, ?, 'system', '2026-01-01T00:00:00+09:00', ?)`,
  )
    .bind(householdId, delta, kind, expiresAt)
    .run();
}

describe('B-05 有効期限の処理', () => {
  blockNetwork();

  it('もらった日から○か月: 期限の日までは失効させず、翌日の処理で失効させる(境界値)', async () => {
    await setRule('point_expiry', { mode: 'months_from_grant', months: 6 });
    const a = await register(PAPA, '2026-01-10T01:00:00Z');
    await checkin(PAPA, [a.dogId], { now: '2026-01-15T01:00:00Z' }); // 期限は 2026-07-15 の終わり
    const row = await env.DB.prepare("SELECT expires_at FROM point_ledger WHERE kind = 'visit'").first<{ expires_at: string }>();
    expect(row!.expires_at).toBe('2026-07-15T23:59:59+09:00');

    await nightly('2026-07-15'); // 期限の日(の 3:10)はまだ使える
    expect(await balance(a.householdId)).toBe(1);
    await nightly('2026-07-16');
    expect(await balance(a.householdId)).toBe(0);
    const exp = await env.DB.prepare("SELECT delta, reason, actor_type FROM point_ledger WHERE kind = 'expire'").first();
    expect(exp).toEqual({ delta: -1, reason: '有効期限切れ(もらった日から6か月)', actor_type: 'system' });
    // もう一度動かしても、二重に失効させない
    await nightly('2026-07-17');
    expect(await balance(a.householdId)).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM point_ledger WHERE kind = 'expire'").first<{ n: number }>())!.n).toBe(1);
    const job = await env.DB.prepare("SELECT status, message FROM system_jobs WHERE name = 'expiry' ORDER BY id DESC").first();
    expect(job).toMatchObject({ status: 'ok' });
    const log = await env.DB.prepare("SELECT actor_type FROM audit_log WHERE action = 'expiry.run'").all();
    expect(log.results).toEqual([{ actor_type: 'system' }]);
  });

  it('もらった日から○か月: 使った分は、期限の早いポイントから使ったものとして数える', async () => {
    await setRule('point_expiry', { mode: 'months_from_grant', months: 6 });
    const a = await register(PAPA, '2026-01-10T01:00:00Z');
    await ledger(a.householdId, 3, 'manual', '2026-03-31T23:59:59+09:00');
    await ledger(a.householdId, 2, 'manual', '2026-09-30T23:59:59+09:00');
    await ledger(a.householdId, -4, 'manual', null); // 4ポイント使った(先の3と、後の1)
    await nightly('2026-04-01');
    expect(await balance(a.householdId)).toBe(1); // 先の3はもう使い切っている
    await nightly('2026-10-01');
    expect(await balance(a.householdId)).toBe(0);

    const b = await register(MAMA, '2026-01-10T01:00:00Z');
    await ledger(b.householdId, 3, 'manual', '2026-03-31T23:59:59+09:00');
    await ledger(b.householdId, 5, 'migration', null); // 期限のない移行のポイント
    await ledger(b.householdId, -2, 'manual', null);
    await nightly('2026-04-01');
    expect(await balance(b.householdId)).toBe(5); // 3のうち使っていない1だけ失効
  });

  it('取り消した来場のポイントは、失効の計算に入れない', async () => {
    await setRule('point_expiry', { mode: 'months_from_grant', months: 1 });
    const a = await register(PAPA, '2026-01-10T01:00:00Z');
    const v = await checkin(PAPA, [a.dogId], { now: '2026-01-15T01:00:00Z' });
    await env.DB.prepare("UPDATE visits SET cancelled_at = 'x' WHERE id = ?").bind(v.body.visitId).run();
    await env.DB.prepare(
      "INSERT INTO point_ledger (household_id, delta, kind, visit_id, actor_type, created_at) VALUES (?, -1, 'cancel', ?, 'staff', 'x')",
    )
      .bind(a.householdId, v.body.visitId)
      .run();
    // 取り消しの -1 を「使った」と数えると、期限の過ぎた +2 の残りが 1 になってしまう
    await ledger(a.householdId, 2, 'manual', '2026-02-10T23:59:59+09:00');
    await nightly('2026-03-01');
    expect(await balance(a.householdId)).toBe(0);
    const exp = await env.DB.prepare("SELECT delta FROM point_ledger WHERE kind = 'expire'").first();
    expect(exp).toEqual({ delta: -2 });
  });

  it('無料券: 期限の日までは未使用のまま、翌日の処理で期限切れにする', async () => {
    await setRule('ticket_expiry', { mode: 'months_from_grant', months: 3 });
    const a = await register(PAPA, '2026-01-10T01:00:00Z');
    await ledger(a.householdId, 9, 'migration', null);
    await checkin(PAPA, [a.dogId], { now: '2026-01-15T01:00:00Z' }); // 10ポイントで無料券(期限 2026-04-15)
    expect(await ticketStatuses(a.householdId)).toEqual(['unused']);
    await nightly('2026-04-15');
    expect(await ticketStatuses(a.householdId)).toEqual(['unused']);
    await nightly('2026-04-16');
    expect(await ticketStatuses(a.householdId)).toEqual(['expired']);
    const t = await env.DB.prepare('SELECT note FROM tickets').first();
    expect(t).toEqual({ note: '有効期限切れ(もらった日から3か月)' });
  });

  it('最後の来場から○か月: 期限の日までは失効させず、翌日に残高を 0 にし、無料券を期限切れにする', async () => {
    await setRule('point_expiry', { mode: 'months_from_last_visit', months: 1 });
    await setRule('ticket_expiry', { mode: 'months_from_last_visit', months: 1 });
    const a = await register(PAPA, '2026-01-10T01:00:00Z');
    await ledger(a.householdId, 9, 'migration', null);
    await checkin(PAPA, [a.dogId], { now: '2026-01-30T01:00:00Z' }); // 無料券1枚、残高0
    await ledger(a.householdId, 4, 'manual', null);
    await checkin(PAPA, [a.dogId], { now: '2026-01-31T01:00:00Z' }); // 最後の来場 1/31、残高5
    const b = await register(MAMA, '2026-01-10T01:00:00Z');
    await checkin(MAMA, [b.dogId], { now: '2026-02-27T01:00:00Z' }); // 最近来たおうち
    const c = await register('U003:むすこ', '2026-01-20T01:00:00Z'); // 来場なし。登録日から数える
    await ledger(c.householdId, 3, 'migration', null);

    await nightly('2026-02-28'); // 1/31 + 1か月 = 2/28(月末)。この日まではまだ使える
    expect(await balance(a.householdId)).toBe(5);
    expect(await ticketStatuses(a.householdId)).toEqual(['unused']);
    expect(await balance(c.householdId)).toBe(0); // 1/20 + 1か月 = 2/20 を過ぎている

    await nightly('2026-03-01');
    expect(await balance(a.householdId)).toBe(0);
    expect(await ticketStatuses(a.householdId)).toEqual(['expired']);
    expect(await balance(b.householdId)).toBe(1);
    const exp = await env.DB.prepare("SELECT delta, reason FROM point_ledger WHERE kind = 'expire' AND household_id = ?")
      .bind(a.householdId)
      .first();
    expect(exp).toEqual({ delta: -5, reason: '有効期限切れ(最後の来場から1か月)' });
  });

  it('期限なしの設定では、ポイントは失効させない', async () => {
    const a = await register(PAPA, '2026-01-10T01:00:00Z');
    await ledger(a.householdId, 3, 'manual', '2026-03-31T23:59:59+09:00');
    await nightly('2027-01-01');
    expect(await balance(a.householdId)).toBe(3);
    const job = await env.DB.prepare("SELECT message FROM system_jobs WHERE name = 'expiry'").first<{ message: string }>();
    expect(job!.message).toBe('期限が切れたポイントと無料券はありませんでした。');
  });
});
