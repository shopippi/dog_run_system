import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { getUndo, type AuditRow } from '../src/services/undo';
import '../src/routes/admin/settings';
import { adminCall, call, checkin, createStaff, exchangeTicket, givePoints, login, passphrase, registerUser } from './helpers';

const NOW = '2026-10-28T01:00:00Z';

async function as(role: 'staff' | 'admin' | 'developer') {
  await createStaff(`${role}@example.com`, role);
  return login(`${role}@example.com`);
}
const patch = (cookie: string, body: unknown) => adminCall('/admin/api/settings', { cookie, method: 'PATCH', body, now: NOW });

async function lastLog() {
  return env.DB.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 1').first<AuditRow>();
}

describe('A-12 ルールの設定', () => {
  it('管理者は設定を読める。受付のQRコードの URL も返す(LINEミニアプリの番号がなければ相対 URL)', async () => {
    const cookie = await as('admin');
    const res = await adminCall('/admin/api/settings', { cookie });
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({ points_per_ticket: 10, daily_point_limit: 1, liff_id: '', repeat_days: 60 });
    expect(res.body.checkinUrl).toBe(`/liff/checkin?k=${await passphrase()}`);

    await patch(cookie, { liff_id: '1234567890-AbCdEfGh' });
    const again = await adminCall('/admin/api/settings', { cookie });
    expect(again.body.checkinUrl).toBe(`https://liff.line.me/1234567890-AbCdEfGh/checkin?k=${await passphrase()}`);
  });

  it('変更は操作ログに前後を残し、変わっていない項目は書かない', async () => {
    const cookie = await as('admin');
    const res = await patch(cookie, { points_per_ticket: 5, repeat_days: 60, point_expiry: { mode: 'months_from_grant', months: 6 } });
    expect(res.status).toBe(200);
    expect(res.body.settings.points_per_ticket).toBe(5);
    expect(res.body.settings.point_expiry).toEqual({ mode: 'months_from_grant', months: 6 });
    const log = await lastLog();
    expect(log).toMatchObject({ action: 'settings.update', target_type: 'settings', actor_id: 1 });
    expect(JSON.parse(log!.before_value!)).toEqual({ points_per_ticket: 10, point_expiry: { mode: 'none' } });
    expect(JSON.parse(log!.after_value!)).toEqual({ points_per_ticket: 5, point_expiry: { mode: 'months_from_grant', months: 6 } });

    // 同じ値をもう一度送っても、操作ログは増えない
    const count = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_log').first<{ n: number }>())!.n;
    const n = await count();
    await patch(cookie, { points_per_ticket: 5 });
    expect(await count()).toBe(n);
  });

  it('無料券に必要なポイント数を変えると、交換に必要なポイント数に効く', async () => {
    const cookie = await as('admin');
    await patch(cookie, { points_per_ticket: 3 });
    const r = await registerUser('U001:パパ');
    await givePoints(r.memberNo, 2);
    const v = await checkin('U001:パパ', [r.dogs[0]!.id], { now: NOW });
    expect(v.body).toMatchObject({ balanceAfter: 3 });
    expect((await call('/api/me', { user: 'U001:パパ', now: NOW })).body.card).toMatchObject({ pointsPerTicket: 3, toNextTicket: 0 });
    const ex = await exchangeTicket('U001:パパ', { now: NOW });
    expect(ex.body).toMatchObject({ pointsUsed: 3, balance: 0, unusedTickets: 1 });
    const me = await call('/api/me', { user: 'U001:パパ', now: NOW });
    expect(me.body.card).toMatchObject({ pointsPerTicket: 3, toNextTicket: 3 });
  });

  it('範囲の外の値は、項目の名前と直し方を日本語で返す(境界値)', async () => {
    const cookie = await as('admin');
    expect((await patch(cookie, { points_per_ticket: 1 })).status).toBe(200);
    expect((await patch(cookie, { points_per_ticket: 100 })).status).toBe(200);
    const zero = await patch(cookie, { points_per_ticket: 0 });
    expect(zero.status).toBe(400);
    expect(zero.body.error.message).toBe('「無料券1枚に必要なポイント数」は、1〜100の数で入れてください。');
    expect((await patch(cookie, { points_per_ticket: 101 })).status).toBe(400);
    expect((await patch(cookie, { daily_point_limit: 11 })).body.error.message).toMatch(/1日にもらえるポイントの上限/);
    expect((await patch(cookie, { ticket_expiry: { mode: 'months_from_last_visit', months: 0 } })).status).toBe(400);
    expect((await patch(cookie, { ticket_expiry: { mode: 'months_from_last_visit', months: 120 } })).status).toBe(200);
    expect((await patch(cookie, { repeat_days: 366 })).status).toBe(400);
    expect((await patch(cookie, { liff_id: 'abc def' })).status).toBe(400);
    // 旧カードから引き継げるポイントの上限(1〜200。初期値 30)
    expect((await adminCall('/admin/api/settings', { cookie })).body.settings.migration_max_points).toBe(30);
    expect((await patch(cookie, { migration_max_points: 1 })).status).toBe(200);
    expect((await patch(cookie, { migration_max_points: 200 })).status).toBe(200);
    expect((await patch(cookie, { migration_max_points: 0 })).body.error.message).toBe('「旧カードから引き継げるポイントの上限」は、1〜200の数で入れてください。');
    expect((await patch(cookie, { migration_max_points: 201 })).status).toBe(400);
    const period = await patch(cookie, { migration_period: { start: '2026-12-01', end: '2026-11-30' } });
    expect(period.status).toBe(400);
    expect(period.body.error.message).toMatch(/移行期間/);
    expect((await patch(cookie, { migration_period: { start: '2026-11-01', end: '2026-12-31' } })).status).toBe(200);
    const unknown = await patch(cookie, { balance: 100 });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.message).toMatch(/変えられない項目/);
  });

  it('合言葉を作り直すと、古いQRコードではチェックインできなくなる', async () => {
    const cookie = await as('admin');
    const old = await passphrase();
    const r = await registerUser('U001:パパ');
    const res = await adminCall('/admin/api/settings/checkin-passphrase', { cookie, body: {}, now: NOW });
    expect(res.status).toBe(200);
    expect(res.body.settings.checkin_passphrase).not.toBe(old);
    expect(res.body.settings.checkin_passphrase).toMatch(/^[0-9a-f]{32}$/);
    const stale = await call('/api/checkins', { user: 'U001:パパ', now: NOW, body: { passphrase: old, dogIds: [r.dogs[0]!.id] } });
    expect(stale.status).toBe(400);
    expect((await checkin('U001:パパ', [r.dogs[0]!.id], { now: NOW })).status).toBe(201);
  });

  it('操作ログから元に戻せる。そのあとにまた変えられていたら戻さない', async () => {
    const cookie = await as('admin');
    await patch(cookie, { points_per_ticket: 5, developer_contact: '090-0000-0000' });
    const log = (await lastLog())!;
    const undo = getUndo('settings.update')!;
    expect(undo).toBeTypeOf('function');
    await undo(env.DB, log, { staffId: 1, now: new Date(NOW) });
    const back = await adminCall('/admin/api/settings', { cookie });
    expect(back.body.settings).toMatchObject({ points_per_ticket: 10, developer_contact: '' });

    await patch(cookie, { points_per_ticket: 6 });
    const log2 = (await lastLog())!;
    await patch(cookie, { points_per_ticket: 7 });
    await expect(undo(env.DB, log2, { staffId: 1, now: new Date(NOW) })).rejects.toMatchObject({ status: 409 });
  });

  it('受付スタッフは読めない・変えられない。製作者は読めるが変えられない(403)', async () => {
    const staff = await as('staff');
    expect((await adminCall('/admin/api/settings', { cookie: staff })).status).toBe(403);
    expect((await patch(staff, { points_per_ticket: 5 })).status).toBe(403);
    const dev = await as('developer');
    expect((await adminCall('/admin/api/settings', { cookie: dev })).status).toBe(200);
    expect((await patch(dev, { points_per_ticket: 5 })).status).toBe(403);
    expect((await adminCall('/admin/api/settings/checkin-passphrase', { cookie: dev, body: {} })).status).toBe(403);
  });
});
