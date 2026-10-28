import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { adminCall, call, checkin, createStaff, dog, givePoints, login, registerUser } from './helpers';

const PAPA = 'U001:パパ';
const DAY1 = '2026-10-28T01:00:00Z';

async function cookieOf(role: 'staff' | 'admin' | 'developer' = 'staff') {
  await createStaff(`${role}@example.com`, role);
  return login(`${role}@example.com`);
}
async function householdIdOf(memberNo: string) {
  const r = await env.DB.prepare('SELECT id FROM households WHERE member_no = ?').bind(memberNo).first<{ id: number }>();
  return r!.id;
}
const proxy = (cookie: string, body: Record<string, unknown>, now = DAY1) =>
  adminCall('/admin/api/checkins/proxy', { cookie, body: { useTicket: false, ...body }, now });

describe('S-04 代理チェックイン', () => {
  it('受付が代わりにチェックインすると、おうちに1ポイント付き、今日の来場に「受付で代理」と出る', async () => {
    const staff = await cookieOf();
    const r = await registerUser(PAPA, [dog('アル'), dog('ニコ')]);
    const householdId = await householdIdOf(r.memberNo);
    const res = await proxy(staff, { householdId, dogIds: r.dogs.map((d) => d.id) });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ pointsAwarded: 1, balanceAfter: 1 });

    const today = await adminCall('/admin/api/today', { cookie: staff, now: DAY1 });
    expect(today.body.visits[0]).toMatchObject({ method: 'proxy', memberNo: r.memberNo, dogCount: 2 });
    const v = await env.DB.prepare('SELECT checked_in_member_id, created_by_staff_id FROM visits').first();
    expect(v).toEqual({ checked_in_member_id: null, created_by_staff_id: 1 });
    const log = await env.DB.prepare("SELECT target_id FROM audit_log WHERE action = 'visit.proxy'").first();
    expect(log).toEqual({ target_id: String(res.body.visitId) });
  });

  it('同じ日にすでにチェックインしていれば、ポイントは増えない', async () => {
    const staff = await cookieOf();
    const r = await registerUser(PAPA);
    await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    const householdId = await householdIdOf(r.memberNo);
    const status = await adminCall(`/admin/api/checkins/proxy/status?householdId=${householdId}`, { cookie: staff, now: DAY1 });
    expect(status.body.visitId).not.toBeNull();
    const res = await proxy(staff, { householdId, dogIds: [r.dogs[0]!.id] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('already_checked_in');
  });

  it('日付を指定して後から入力できる(障害のときに紙に書いた分)', async () => {
    const staff = await cookieOf();
    const r = await registerUser(PAPA);
    const householdId = await householdIdOf(r.memberNo);
    const res = await proxy(staff, { householdId, dogIds: [r.dogs[0]!.id], date: '2026-10-25' });
    expect(res.status).toBe(201);
    const v = await env.DB.prepare('SELECT visit_date, method FROM visits').first();
    expect(v).toEqual({ visit_date: '2026-10-25', method: 'proxy' });
    // その日の分と今日の分は、別の日なのでどちらもポイントが付く
    await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    expect((await call('/api/me', { user: PAPA, now: DAY1 })).body.card.balance).toBe(2);
  });

  it('先の日付や、90日より前の日付は入力できない', async () => {
    const staff = await cookieOf();
    const r = await registerUser(PAPA);
    const householdId = await householdIdOf(r.memberNo);
    const future = await proxy(staff, { householdId, dogIds: [r.dogs[0]!.id], date: '2026-10-29' });
    expect(future.status).toBe(400);
    expect(future.body.error.message).toMatch(/先の日付/);
    const old = await proxy(staff, { householdId, dogIds: [r.dogs[0]!.id], date: '2026-07-29' });
    expect(old.status).toBe(400);
    expect(old.body.error.message).toMatch(/90日前まで/);
  });

  it('無料券を使える。使える枚数を事前に確かめられる', async () => {
    const staff = await cookieOf();
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 9);
    await checkin(PAPA, [r.dogs[0]!.id], { now: '2026-10-27T01:00:00Z' });
    const householdId = await householdIdOf(r.memberNo);
    const status = await adminCall(`/admin/api/checkins/proxy/status?householdId=${householdId}`, { cookie: staff, now: DAY1 });
    expect(status.body).toEqual({ date: '2026-10-28', unusedTickets: 1, visitId: null });
    const res = await proxy(staff, { householdId, dogIds: [r.dogs[0]!.id], useTicket: true });
    expect(res.body).toMatchObject({ usedTicket: true });
  });

  it('よそのおうちの犬は選べない。統合済みのおうちにはチェックインできない', async () => {
    const staff = await cookieOf();
    const a = await registerUser(PAPA);
    const b = await registerUser('U002:よそ', [dog('ハナ')]);
    const householdId = await householdIdOf(a.memberNo);
    expect((await proxy(staff, { householdId, dogIds: [b.dogs[0]!.id] })).status).toBe(400);
    await env.DB.prepare("UPDATE households SET status = 'merged' WHERE id = ?").bind(householdId).run();
    const res = await proxy(staff, { householdId, dogIds: [a.dogs[0]!.id] });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/統合先/);
  });

  it('製作者は代理チェックインできない', async () => {
    const dev = await cookieOf('developer');
    const r = await registerUser(PAPA);
    const res = await proxy(dev, { householdId: await householdIdOf(r.memberNo), dogIds: [r.dogs[0]!.id] });
    expect(res.status).toBe(403);
  });
});
