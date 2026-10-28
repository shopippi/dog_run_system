import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { adminCall, call, checkin, createStaff, dog, exchangeTicket, givePoints, login, registerUser, useTicketOf } from './helpers';

const PAPA = 'U001:パパ';
const DAY1 = '2026-10-28T01:00:00Z';
const DAY2 = '2026-10-29T01:00:00Z';

async function staffCookie(role: 'staff' | 'admin' | 'developer' = 'staff') {
  await createStaff(`${role}@example.com`, role);
  return login(`${role}@example.com`);
}
const cancel = (cookie: string, visitId: number, reason = '入力ミス', now = DAY1) =>
  adminCall(`/admin/api/checkins/${visitId}/cancel`, { cookie, body: { reason }, now });
const card = async (now = DAY1) => (await call('/api/me', { user: PAPA, now })).body.card;
/** 以前の動き(10ポイントでチェックインのときに自動発行)の記録を、その来場に作る */
async function legacyIssue(visitId: number) {
  await env.DB.prepare(
    `INSERT INTO tickets (household_id, issued_at, source, issued_visit_id, status)
     SELECT household_id, checked_in_at, 'points', id, 'unused' FROM visits WHERE id = ?`,
  )
    .bind(visitId)
    .run();
  await env.DB.prepare(
    `INSERT INTO point_ledger (household_id, delta, kind, visit_id, ticket_id, actor_type, created_at)
     SELECT household_id, -10, 'ticket_issue', id, (SELECT MAX(id) FROM tickets), 'member', checked_in_at FROM visits WHERE id = ?`,
  )
    .bind(visitId)
    .run();
}

describe('S-03 チェックインの取り消し', () => {
  it('取り消すと付けたポイントを戻し、来場は「取り消し済み」として残る', async () => {
    const cookie = await staffCookie();
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 3);
    const v = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    expect((await card()).balance).toBe(4);

    const res = await cancel(cookie, v.body.visitId);
    expect(res.status).toBe(200);
    expect((await card()).balance).toBe(3);
    const row = await env.DB.prepare('SELECT cancelled_at, cancel_reason, cancelled_by_staff_id FROM visits').first();
    expect(row).toEqual({ cancelled_at: '2026-10-28T10:00:00+09:00', cancel_reason: '入力ミス', cancelled_by_staff_id: 1 });
    const last = await env.DB.prepare('SELECT delta, kind FROM point_ledger ORDER BY id DESC').first();
    expect(last).toEqual({ delta: -1, kind: 'cancel' });
  });

  it('以前の記録で、9→10で発行された無料券は回収し、9ポイントに戻る', async () => {
    const cookie = await staffCookie();
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 9);
    const v = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    await legacyIssue(v.body.visitId);
    expect(await card()).toMatchObject({ balance: 0 });
    expect((await card()).tickets).toHaveLength(1);

    await cancel(cookie, v.body.visitId);
    const after = await card();
    expect(after.balance).toBe(9);
    expect(after.tickets).toHaveLength(0);
    const t = await env.DB.prepare('SELECT status FROM tickets').first();
    expect(t).toEqual({ status: 'void' });
  });

  it('その来場に結びついた無料券の使用は未使用に戻る。付けたポイントも戻る', async () => {
    const cookie = await staffCookie();
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 10);
    await exchangeTicket(PAPA, { now: DAY1 });
    await useTicketOf(PAPA, { now: DAY2 });
    const v = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY2 });
    expect(await card(DAY2)).toMatchObject({ balance: 1, tickets: [] });
    await cancel(cookie, v.body.visitId, '入力ミス', DAY2);
    const after = await card(DAY2);
    expect(after.tickets).toHaveLength(1);
    expect(after.balance).toBe(0);
    expect(await env.DB.prepare('SELECT status, used_visit_id, used_at FROM tickets').first()).toEqual({
      status: 'unused',
      used_visit_id: null,
      used_at: null,
    });
    // 今日の来場の「無料券を使用」の印も消える
    const today = await adminCall('/admin/api/today', { cookie, now: DAY2 });
    expect(today.body.totals).toMatchObject({ groups: 0, ticketsUsed: 0 });
  });

  it('ほかの日に使った無料券は、取り消しても戻らない', async () => {
    const cookie = await staffCookie();
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 10);
    await exchangeTicket(PAPA, { now: DAY1 });
    await useTicketOf(PAPA, { now: DAY1 });
    const v = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY2 });
    await cancel(cookie, v.body.visitId, '入力ミス', DAY2);
    expect(await env.DB.prepare('SELECT status FROM tickets').first()).toEqual({ status: 'used' });
  });

  it('以前の記録で、発行された無料券がもう使われていたら、取り消せない', async () => {
    const cookie = await staffCookie();
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 9);
    const first = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    await legacyIssue(first.body.visitId);
    await useTicketOf(PAPA, { now: DAY2 });
    const res = await cancel(cookie, first.body.visitId, '入力ミス', DAY2);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/もう使われているため取り消せません/);
  });

  it('取り消した日は、もう一度チェックインでき、ポイントも付く', async () => {
    const cookie = await staffCookie();
    const r = await registerUser(PAPA);
    const v = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    await cancel(cookie, v.body.visitId);
    const again = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    expect(again.status).toBe(201);
    expect((await card()).balance).toBe(1);
  });

  it('2回取り消しても、二重に戻さない', async () => {
    const cookie = await staffCookie();
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 5);
    const v = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    const results = await Promise.all([cancel(cookie, v.body.visitId), cancel(cookie, v.body.visitId)]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
    expect((await card()).balance).toBe(5);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'visit.cancel'").first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it('操作ログに、誰が・いつ・理由・元に戻すための情報を残す', async () => {
    const cookie = await staffCookie();
    const r = await registerUser(PAPA);
    const v = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    await cancel(cookie, v.body.visitId, '二重のチェックイン');
    const log = await env.DB.prepare('SELECT actor_type, actor_id, action, target_id, reason, undo_info FROM audit_log').first();
    expect(log).toEqual({
      actor_type: 'staff',
      actor_id: 1,
      action: 'visit.cancel',
      target_id: String(v.body.visitId),
      reason: '二重のチェックイン',
      undo_info: JSON.stringify({ visitId: v.body.visitId }),
    });
  });

  it('理由がないと取り消せない', async () => {
    const cookie = await staffCookie();
    const r = await registerUser(PAPA);
    const v = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    const res = await cancel(cookie, v.body.visitId, ' ');
    expect(res.status).toBe(400);
  });

  it('管理者も取り消せる。製作者は 403', async () => {
    const admin = await staffCookie('admin');
    const dev = await staffCookie('developer');
    const r = await registerUser(PAPA, [dog('アル')]);
    const v = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    expect((await cancel(dev, v.body.visitId)).status).toBe(403);
    expect((await cancel(admin, v.body.visitId)).status).toBe(200);
  });

  it('ない来場は 404', async () => {
    const cookie = await staffCookie();
    expect((await cancel(cookie, 999)).status).toBe(404);
  });
});
