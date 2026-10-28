import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { adminCall, call, checkin, createStaff, givePoints, login, registerUser } from './helpers';

const PAPA = 'U001:パパ';
const DAY1 = '2026-10-28T01:00:00Z';
const DAY2 = '2026-10-29T01:00:00Z';

async function cookies() {
  await createStaff('staff@example.com', 'staff');
  await createStaff('admin@example.com', 'admin');
  await createStaff('dev@example.com', 'developer');
  return {
    staff: await login('staff@example.com'),
    admin: await login('admin@example.com'),
    dev: await login('dev@example.com'),
  };
}
const cancel = (cookie: string, visitId: number, now = DAY1) =>
  adminCall(`/admin/api/checkins/${visitId}/cancel`, { cookie, body: { reason: '入力ミス' }, now });
const audit = (cookie: string, query = '') => adminCall(`/admin/api/audit${query}`, { cookie });
const undo = (cookie: string, id: number, now = DAY1) => adminCall(`/admin/api/audit/${id}/undo`, { cookie, body: {}, now });
const card = async (now = DAY1) => (await call('/api/me', { user: PAPA, now })).body.card;
const logId = async (action: string) =>
  (await env.DB.prepare('SELECT id FROM audit_log WHERE action = ? ORDER BY id DESC').bind(action).first<{ id: number }>())!.id;

describe('A-15 操作ログの一覧', () => {
  it('誰が・いつ・何を・対象・理由を、日本語の言葉で新しい順に返す', async () => {
    const c = await cookies();
    const r = await registerUser(PAPA);
    const v = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    await adminCall('/admin/api/walkins', { cookie: c.staff, body: { dogCount: 2 }, now: DAY1 });
    await cancel(c.staff, v.body.visitId);

    const res = await audit(c.admin);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const [first, second] = res.body.entries;
    expect(first).toMatchObject({
      actorName: '受付',
      actionLabel: 'チェックインの取り消し',
      target: { label: 'アルのおうちの10月28日の来場', code: r.memberNo },
      reason: '入力ミス',
      detail: '付けたポイントを戻した',
      canUndo: true,
      undone: null,
    });
    expect(first.at).toBe('2026-10-28T10:00:00+09:00');
    expect(second).toMatchObject({ actionLabel: '会員以外の記録', target: { label: '会員以外 2頭(10月28日)' }, canUndo: false });
    // 操作の記号(visit.cancel など)は、行の中には出さない
    expect(JSON.stringify(res.body.entries)).not.toMatch(/visit\./);
    expect(res.body.actions).toEqual(
      expect.arrayContaining([{ value: 'visit.cancel', label: 'チェックインの取り消し' }]),
    );
  });

  it('日付と操作の種類で絞り込め、50件ずつページを送れる', async () => {
    const c = await cookies();
    for (let i = 0; i < 52; i++) {
      await adminCall('/admin/api/walkins', { cookie: c.staff, body: { dogCount: 1 }, now: DAY1 });
    }
    await adminCall('/admin/api/walkins', { cookie: c.staff, body: { dogCount: 3 }, now: DAY2 });
    const r = await registerUser(PAPA);
    const v = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY2 });
    await cancel(c.staff, v.body.visitId, DAY2);

    const all = await audit(c.admin);
    expect(all.body.total).toBe(54);
    expect(all.body.entries).toHaveLength(50);
    const page2 = await audit(c.admin, '?page=2');
    expect(page2.body.entries).toHaveLength(4);
    expect(page2.body.page).toBe(2);

    const day1 = await audit(c.admin, '?from=2026-10-28&to=2026-10-28');
    expect(day1.body.total).toBe(52);
    const day2 = await audit(c.admin, '?from=2026-10-29');
    expect(day2.body.total).toBe(2);
    const cancels = await audit(c.admin, '?action=visit.cancel');
    expect(cancels.body.total).toBe(1);
    expect(cancels.body.entries[0].actionLabel).toBe('チェックインの取り消し');

    const bad = await audit(c.admin, '?from=2026/10/28');
    expect(bad.status).toBe(400);
  });

  it('受付スタッフは見られない(403)。製作者は見られるが、元に戻すは出ず、押しても 403', async () => {
    const c = await cookies();
    const r = await registerUser(PAPA);
    const v = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    await cancel(c.staff, v.body.visitId);

    expect((await audit(c.staff)).status).toBe(403);
    const dev = await audit(c.dev);
    expect(dev.status).toBe(200);
    expect(dev.body.entries[0].canUndo).toBe(false);
    const id = await logId('visit.cancel');
    expect((await undo(c.dev, id)).status).toBe(403);
    expect((await undo(c.staff, id)).status).toBe(403);
  });
});

describe('A-15 元に戻す(S-03 の取り消し)', () => {
  it('取り消しを元に戻すと、来場とポイントが戻り、操作ログに「元に戻し済み」と、戻した操作が残る', async () => {
    const c = await cookies();
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 3);
    const v = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    await cancel(c.staff, v.body.visitId);
    expect((await card()).balance).toBe(3);

    const id = await logId('visit.cancel');
    const res = await undo(c.admin, id);
    expect(res.status).toBe(200);
    expect((await card()).balance).toBe(4);
    expect((await card()).todayVisitId).toBe(v.body.visitId);
    const visit = await env.DB.prepare('SELECT cancelled_at, cancel_reason FROM visits WHERE id = ?').bind(v.body.visitId).first();
    expect(visit).toEqual({ cancelled_at: null, cancel_reason: null });
    const today = await adminCall('/admin/api/today', { cookie: c.admin, now: DAY1 });
    expect(today.body.visits[0].cancelled).toBe(false);

    const list = await audit(c.admin);
    expect(list.body.entries[0]).toMatchObject({
      actionLabel: '元に戻す',
      actorName: '管理者',
      target: { label: 'アルのおうちの10月28日の来場', code: r.memberNo },
      detail: '「チェックインの取り消し」を元に戻した',
      canUndo: false,
    });
    expect(list.body.entries[1]).toMatchObject({ canUndo: false, undone: { byName: '管理者', at: '2026-10-28T10:00:00+09:00' } });

    const again = await undo(c.admin, id);
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/すでに元に戻されています/);
  });

  it('9→10 で発行して回収した無料券は未使用に戻り、残高は 0 に戻る', async () => {
    const c = await cookies();
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 9);
    const v = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    await cancel(c.staff, v.body.visitId);
    expect(await card()).toMatchObject({ balance: 9, tickets: [] });

    expect((await undo(c.admin, await logId('visit.cancel'))).status).toBe(200);
    const after = await card();
    expect(after.balance).toBe(0);
    expect(after.tickets).toHaveLength(1);
    const t = await env.DB.prepare('SELECT status, issued_visit_id FROM tickets').first();
    expect(t).toEqual({ status: 'unused', issued_visit_id: v.body.visitId });
  });

  it('使った無料券は、もう一度「使用済み」になる', async () => {
    const c = await cookies();
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 9);
    await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    const v = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY2, useTicket: true });
    await cancel(c.staff, v.body.visitId, DAY2);
    expect((await card(DAY2)).tickets).toHaveLength(1);

    expect((await undo(c.admin, await logId('visit.cancel'), DAY2)).status).toBe(200);
    expect((await card(DAY2)).tickets).toHaveLength(0);
    const t = await env.DB.prepare('SELECT status, used_visit_id FROM tickets').first();
    expect(t).toEqual({ status: 'used', used_visit_id: v.body.visitId });
  });

  it('同じ日にすでに別の来場があれば戻せない(409)。操作ログは戻していない状態のまま', async () => {
    const c = await cookies();
    const r = await registerUser(PAPA);
    const v = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    await cancel(c.staff, v.body.visitId);
    const again = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    expect(again.status).toBe(201);

    const id = await logId('visit.cancel');
    const res = await undo(c.admin, id);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/別のチェックインがあるため戻せません/);
    const row = await env.DB.prepare('SELECT undone_at FROM audit_log WHERE id = ?').bind(id).first();
    expect(row).toEqual({ undone_at: null });
    expect((await card()).balance).toBe(1);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'audit.undo'").first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it('取り消しのあとにポイントが使われて足りなくなるときは戻せない(409)', async () => {
    const c = await cookies();
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 9);
    const v = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    await cancel(c.staff, v.body.visitId);
    // 取り消し後の 9 ポイントから、次の日の来場で無料券が発行され 0 ポイントになる
    await checkin(PAPA, [r.dogs[0]!.id], { now: DAY2 });
    expect((await card(DAY2)).balance).toBe(0);
    const res = await undo(c.admin, await logId('visit.cancel'), DAY2);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/ポイントが足りなく/);
  });

  it('戻し方が登録されていない操作は 409 で理由を返す', async () => {
    const c = await cookies();
    await adminCall('/admin/api/walkins', { cookie: c.staff, body: { dogCount: 2 }, now: DAY1 });
    const res = await undo(c.admin, await logId('visit.walkin'));
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/操作ログからは元に戻せません/);
    expect((await undo(c.admin, 9999)).status).toBe(404);
  });

  it('同時に2回押しても、1回だけ戻す', async () => {
    const c = await cookies();
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 5);
    const v = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    await cancel(c.staff, v.body.visitId);
    const id = await logId('visit.cancel');
    const results = await Promise.all([undo(c.admin, id), undo(c.admin, id)]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
    expect((await card()).balance).toBe(6);
  });
});
