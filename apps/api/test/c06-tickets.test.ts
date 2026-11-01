import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { getUndo, type AuditRow } from '../src/services/undo';
import '../src/routes/admin/tickets';
import { addFamily, adminCall, call, checkin, createStaff, dog, exchangeTicket, givePoints, login, registerUser, useTicketOf } from './helpers';

const PAPA = 'U001:パパ';
const MAMA = 'U002:ママ';
const DAY1 = '2026-10-28T01:00:00Z'; // 日本時間 10:00
const DAY2 = '2026-10-29T01:00:00Z';

const me = async (user = PAPA, now = DAY1) => (await call('/api/me', { user, now })).body;
const tickets = async () =>
  (await env.DB.prepare('SELECT id, status, source, used_at, used_visit_id FROM tickets ORDER BY id').all()).results;
async function householdIdOf(memberNo: string) {
  return (await env.DB.prepare('SELECT id FROM households WHERE member_no = ?').bind(memberNo).first<{ id: number }>())!.id;
}
async function cookieOf(role: 'staff' | 'admin' | 'developer') {
  await createStaff(`${role}@example.com`, role);
  return login(`${role}@example.com`);
}
const markUsed = (cookie: string, householdId: number, ticketId: number, now = DAY1) =>
  adminCall(`/admin/api/households/${householdId}/tickets/${ticketId}/use`, { cookie, body: {}, now });

describe('C-06 無料券と交換する(8章)', () => {
  it('10ポイントで交換すると、台帳に −10 の「無料券と交換」と、未使用の券が1枚できる。操作ログはお客さんの操作として残る', async () => {
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 12);
    const res = await exchangeTicket(PAPA, { now: DAY1 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ticketId: expect.any(Number), pointsUsed: 10, balance: 2, unusedTickets: 1 });
    expect(await tickets()).toEqual([{ id: res.body.ticketId, status: 'unused', source: 'points', used_at: null, used_visit_id: null }]);
    const ledger = await env.DB.prepare("SELECT delta, kind, ticket_id, actor_type, actor_id FROM point_ledger WHERE kind = 'ticket_issue'").all();
    expect(ledger.results).toEqual([{ delta: -10, kind: 'ticket_issue', ticket_id: res.body.ticketId, actor_type: 'member', actor_id: 1 }]);
    const log = await env.DB.prepare("SELECT actor_type, actor_id, target_type, after_value FROM audit_log WHERE action = 'ticket.exchange'").first<{
      actor_type: string;
      actor_id: number;
      target_type: string;
      after_value: string;
    }>();
    expect(log).toMatchObject({ actor_type: 'member', actor_id: 1, target_type: 'household' });
    expect(JSON.parse(log!.after_value)).toEqual({ ticketId: res.body.ticketId, points: 10 });
    expect((await me()).card).toMatchObject({ balance: 2, toNextTicket: 8, tickets: [{ id: res.body.ticketId }] });
  });

  it('9ポイントでは交換できない(境界の1つ手前)。ちょうど10なら交換でき、0ポイントになる', async () => {
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 9);
    const short = await exchangeTicket(PAPA, { now: DAY1 });
    expect(short.status).toBe(409);
    expect(short.body.error).toMatchObject({ code: 'not_enough_points' });
    expect(short.body.error.message).toBe('ポイントが足りないため、無料券と交換できません(いま9ポイント)。あと1ポイントたまると交換できます。');
    expect(await tickets()).toEqual([]);
    await givePoints(r.memberNo, 1);
    expect((await exchangeTicket(PAPA, { now: DAY1 })).body).toMatchObject({ balance: 0, unusedTickets: 1 });
    expect((await exchangeTicket(PAPA, { now: DAY1 })).status).toBe(409);
  });

  it('20ポイントあれば2回交換できる。交換しないうちは、ポイントはたまり続ける', async () => {
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 20);
    await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    expect((await me()).card).toMatchObject({ balance: 21, toNextTicket: 0, tickets: [] });
    await exchangeTicket(PAPA, { now: DAY1 });
    await exchangeTicket(PAPA, { now: DAY1 });
    expect((await me()).card).toMatchObject({ balance: 1, toNextTicket: 9 });
    expect((await me()).card.tickets).toHaveLength(2);
  });

  it('同じ印で二重に送られても、券は1枚だけ(1回目の結果を返す)', async () => {
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 30);
    const opId = 'aaaaaaaa-1111-2222-3333-444444444444';
    const [a, b] = await Promise.all([exchangeTicket(PAPA, { now: DAY1, opId }), exchangeTicket(PAPA, { now: DAY1, opId })]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.ticketId).toBe(b.body.ticketId);
    const again = await exchangeTicket(PAPA, { now: DAY1, opId });
    expect(again.body.ticketId).toBe(a.body.ticketId);
    expect(await tickets()).toHaveLength(1);
    expect((await me()).card.balance).toBe(20);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ticket.exchange'").first<{ n: number }>())!.n).toBe(1);
  });

  it('家族が同時に押しても、残高を超えて交換しない(10ポイントで2人が押すと1枚だけ)', async () => {
    const r = await registerUser(PAPA);
    await addFamily(r.memberNo, 'U002', 'ママ');
    await givePoints(r.memberNo, 10);
    const results = await Promise.all([exchangeTicket(PAPA, { now: DAY1 }), exchangeTicket(MAMA, { now: DAY1 })]);
    expect(results.map((x) => x.status).sort()).toEqual([201, 409]);
    expect(await tickets()).toHaveLength(1);
    expect((await me()).card.balance).toBe(0);
  });

  it('交換に必要なポイント数は設定(points_per_ticket)に従う。期限の設定があれば、券に期限が付く', async () => {
    const r = await registerUser(PAPA);
    await env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('points_per_ticket', '5', 'x'), ('ticket_expiry', '{"mode":"months_from_grant","months":6}', 'x')`,
    ).run();
    await givePoints(r.memberNo, 5);
    const res = await exchangeTicket(PAPA, { now: DAY1 });
    expect(res.body).toMatchObject({ pointsUsed: 5, balance: 0 });
    expect((await me()).card.tickets[0].expiresAt).toBe('2027-04-28T23:59:59+09:00');
  });

  it('入力の印の形が違うときは 400。会員でなければ交換できない', async () => {
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 10);
    expect((await exchangeTicket(PAPA, { now: DAY1, opId: 'bad id!' })).status).toBe(400);
    expect((await exchangeTicket('U999:だれか', { now: DAY1 })).status).toBe(409);
    expect(await tickets()).toEqual([]);
  });
});

describe('C-06 無料券を使用する(8章)', () => {
  it('使うと「使用済み」になり、使った日時(日本時間)とその日の来場が結びつく。応答にサーバーの時刻とおうちの名前を返す', async () => {
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 10);
    const ex = await exchangeTicket(PAPA, { now: DAY1 });
    const v = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY2 });
    const res = await useTicketOf(PAPA, { now: '2026-10-29T01:30:00Z' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ticketId: ex.body.ticketId,
      memberNo: r.memberNo,
      householdName: 'アルのおうち',
      usedAt: '2026-10-29T10:30:00+09:00',
      usedDate: '2026-10-29',
      isToday: true,
      visitId: v.body.visitId,
      serverTime: '2026-10-29T10:30:00+09:00',
      unusedTickets: 0,
    });
    expect(await tickets()).toEqual([
      { id: ex.body.ticketId, status: 'used', source: 'points', used_at: '2026-10-29T10:30:00+09:00', used_visit_id: v.body.visitId },
    ]);
    const log = await env.DB.prepare("SELECT actor_type, actor_id, target_id FROM audit_log WHERE action = 'ticket.use'").first();
    expect(log).toEqual({ actor_type: 'member', actor_id: 1, target_id: String(await householdIdOf(r.memberNo)) });
  });

  it('チェックインの前に使ったときは、来場はまだ結びつかない(チェックインしたときに結びつく)', async () => {
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 10);
    await exchangeTicket(PAPA, { now: DAY1 });
    const res = await useTicketOf(PAPA, { now: DAY2 });
    expect(res.body).toMatchObject({ visitId: null, isToday: true });
    const v = await checkin(PAPA, [r.dogs[0]!.id], { now: '2026-10-29T01:10:00Z' });
    expect((await call(`/api/tickets/${res.body.ticketId}`, { user: PAPA, now: '2026-10-29T01:10:00Z' })).body.visitId).toBe(v.body.visitId);
  });

  it('使用済みの券をもう一度使うと 409。同時に2回押しても1回だけ使う', async () => {
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 10);
    const ex = await exchangeTicket(PAPA, { now: DAY1 });
    const results = await Promise.all([
      useTicketOf(PAPA, { now: DAY1, ticketId: ex.body.ticketId }),
      useTicketOf(PAPA, { now: DAY1, ticketId: ex.body.ticketId }),
    ]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
    const again = await useTicketOf(PAPA, { now: DAY1, ticketId: ex.body.ticketId });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'ticket_used', message: 'この無料券は、もう使用済みです。会員証を開き直してください。' });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ticket.use'").first<{ n: number }>())!.n).toBe(1);
  });

  it('よそのおうちの券は使えない(404)。期限切れ・取り消しの券は使えない(409)', async () => {
    const r = await registerUser(PAPA);
    await registerUser('U900:よそ', [dog('ハナ')]);
    await givePoints(r.memberNo, 10);
    const ex = await exchangeTicket(PAPA, { now: DAY1 });
    const other = await useTicketOf('U900:よそ', { now: DAY1, ticketId: ex.body.ticketId });
    expect(other.status).toBe(404);
    expect((await useTicketOf(PAPA, { now: DAY1, ticketId: 9999 })).status).toBe(404);
    // 期限が昨日までの券
    await env.DB.prepare("UPDATE tickets SET expires_at = '2026-10-27T23:59:59+09:00'").run();
    const expired = await useTicketOf(PAPA, { now: DAY1, ticketId: ex.body.ticketId });
    expect(expired.status).toBe(409);
    expect(expired.body.error.code).toBe('ticket_expired');
    // 期限の日の終わりまでは使える(境界)
    await env.DB.prepare("UPDATE tickets SET expires_at = '2026-10-28T23:59:59+09:00'").run();
    expect((await useTicketOf(PAPA, { now: '2026-10-28T14:59:59Z', ticketId: ex.body.ticketId })).status).toBe(200);
    await env.DB.prepare("UPDATE tickets SET status = 'void', used_at = NULL").run();
    expect((await useTicketOf(PAPA, { now: DAY1, ticketId: ex.body.ticketId })).body.error.code).toBe('ticket_void');
  });

  it('使った券の画面(GET)は、自分のおうちの使用済みの券だけ。前の日の券は「今日ではない」', async () => {
    const r = await registerUser(PAPA);
    await addFamily(r.memberNo, 'U002', 'ママ');
    await registerUser('U900:よそ', [dog('ハナ')]);
    await givePoints(r.memberNo, 20);
    const used = await exchangeTicket(PAPA, { now: DAY1 });
    const unused = await exchangeTicket(PAPA, { now: DAY1 });
    await useTicketOf(PAPA, { now: DAY1, ticketId: used.body.ticketId });
    const mama = await call(`/api/tickets/${used.body.ticketId}`, { user: MAMA, now: DAY2 });
    expect(mama.status).toBe(200);
    expect(mama.body).toMatchObject({ isToday: false, usedDate: '2026-10-28', serverTime: '2026-10-29T10:00:00+09:00', unusedTickets: 1 });
    expect((await call(`/api/tickets/${unused.body.ticketId}`, { user: PAPA, now: DAY1 })).status).toBe(404);
    expect((await call(`/api/tickets/${used.body.ticketId}`, { user: 'U900:よそ', now: DAY1 })).status).toBe(404);
  });

  it('今日の来場(S-02)の「無料券を使用」の印は、その日・そのおうちで使った券から出す(来場に結びついていなくても)', async () => {
    const staff = await cookieOf('staff');
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 10);
    await exchangeTicket(PAPA, { now: DAY1 });
    const v = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY2 });
    let today = await adminCall('/admin/api/today', { cookie: staff, now: DAY2 });
    expect(today.body.visits[0]).toMatchObject({ id: v.body.visitId, usedTicket: false });
    await useTicketOf(PAPA, { now: '2026-10-29T02:00:00Z' });
    // 結びつきを外しても、その日に使った券があれば印が出る
    await env.DB.prepare('UPDATE tickets SET used_visit_id = NULL').run();
    today = await adminCall('/admin/api/today', { cookie: staff, now: '2026-10-29T02:00:00Z' });
    expect(today.body.visits[0]).toMatchObject({ id: v.body.visitId, usedTicket: true });
    expect(today.body.totals.ticketsUsed).toBe(1);
    // 次の日の来場には出ない
    await checkin(PAPA, [r.dogs[0]!.id], { now: '2026-10-30T01:00:00Z' });
    const next = await adminCall('/admin/api/today', { cookie: staff, now: '2026-10-30T01:00:00Z' });
    expect(next.body.visits[0]).toMatchObject({ usedTicket: false });
  });

  it('来場履歴(C-07)に、交換と使用が新しい順に出る', async () => {
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 20);
    const a = await exchangeTicket(PAPA, { now: DAY1 });
    const b = await exchangeTicket(PAPA, { now: '2026-10-28T02:00:00Z' });
    await useTicketOf(PAPA, { now: DAY2, ticketId: a.body.ticketId });
    const res = await call('/api/tickets/history', { user: PAPA, now: DAY2 });
    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([
      { kind: 'use', ticketId: a.body.ticketId, at: '2026-10-29T10:00:00+09:00', points: 0 },
      { kind: 'exchange', ticketId: b.body.ticketId, at: '2026-10-28T11:00:00+09:00', points: 10 },
      { kind: 'exchange', ticketId: a.body.ticketId, at: '2026-10-28T10:00:00+09:00', points: 10 },
    ]);
    expect((await call('/api/tickets/history', { user: 'U900:よそ', now: DAY2 })).status).toBe(409);
  });
});

describe('C-06 自動では交換しない(統合・旧カード・手動)', () => {
  it('おうちをまとめて合計が10以上になっても、無料券は出ない', async () => {
    const admin = await cookieOf('admin');
    const papa = await registerUser(PAPA);
    const mama = await registerUser(MAMA, [dog('ニコ')]);
    await givePoints(papa.memberNo, 7);
    await givePoints(mama.memberNo, 5);
    const res = await adminCall('/admin/api/merges', {
      cookie: admin,
      body: { keepHouseholdId: await householdIdOf(papa.memberNo), absorbHouseholdId: await householdIdOf(mama.memberNo) },
      now: DAY1,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ points: 12, ticketsIssued: 0 });
    expect((await me()).card).toMatchObject({ balance: 12, tickets: [], toNextTicket: 0 });
    expect(await tickets()).toEqual([]);
  });

  it('管理者は、手動の登録で無料券を足せる(足した券も「使用する」で使える)', async () => {
    const admin = await cookieOf('admin');
    const r = await registerUser(PAPA);
    const id = await householdIdOf(r.memberNo);
    const res = await adminCall(`/admin/api/households/${id}/points`, { cookie: admin, body: { points: 0, tickets: 1, reason: 'お詫び' }, now: DAY1 });
    expect(res.status).toBe(201);
    expect((await me()).card.tickets).toHaveLength(1);
    expect((await useTicketOf(PAPA, { now: DAY1 })).status).toBe(200);
  });
});

describe('M-06 無料券を使用済みにする(受付・管理者)', () => {
  it('受付スタッフと管理者は使用済みにできる。その日の来場に結びつき、操作ログに残り、操作ログから未使用に戻せる', async () => {
    const staff = await cookieOf('staff');
    const admin = await cookieOf('admin');
    const r = await registerUser(PAPA);
    const id = await householdIdOf(r.memberNo);
    await givePoints(r.memberNo, 20);
    const a = await exchangeTicket(PAPA, { now: DAY1 });
    const b = await exchangeTicket(PAPA, { now: DAY1 });
    const v = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    const res = await markUsed(staff, id, a.body.ticketId, '2026-10-28T01:30:00Z');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ auditId: expect.any(Number), ticketId: a.body.ticketId, usedAt: '2026-10-28T10:30:00+09:00', visitId: v.body.visitId });
    expect((await markUsed(admin, id, b.body.ticketId)).status).toBe(200);

    const log = await adminCall('/admin/api/audit', { cookie: admin, now: DAY1 });
    const entry = log.body.entries.find((e: { actionLabel: string; actorName: string }) => e.actionLabel === '無料券を使用済みにする' && e.actorName === '受付');
    expect(entry).toMatchObject({ target: { label: 'アルのおうち', code: r.memberNo }, detail: '無料券1枚を使用済みにした(10月28日 10:30)', canUndo: true });
    const undo = await adminCall(`/admin/api/audit/${entry.id}/undo`, { cookie: admin, body: {}, now: DAY1 });
    expect(undo.status).toBe(200);
    expect((await tickets()).find((t: any) => t.id === a.body.ticketId)).toMatchObject({ status: 'unused', used_at: null, used_visit_id: null });
    // 戻した券は、もう一度使える
    expect((await markUsed(staff, id, a.body.ticketId)).status).toBe(200);
  });

  it('製作者は 403。使用済み・よそのおうちの券は使用済みにできない。統合済みのおうちは 409', async () => {
    const dev = await cookieOf('developer');
    const staff = await cookieOf('staff');
    const r = await registerUser(PAPA);
    const other = await registerUser('U900:よそ', [dog('ハナ')]);
    const id = await householdIdOf(r.memberNo);
    await givePoints(r.memberNo, 10);
    const ex = await exchangeTicket(PAPA, { now: DAY1 });
    expect((await markUsed(dev, id, ex.body.ticketId)).status).toBe(403);
    expect((await markUsed(staff, await householdIdOf(other.memberNo), ex.body.ticketId)).status).toBe(404);
    expect((await markUsed(staff, id, ex.body.ticketId)).status).toBe(200);
    const twice = await markUsed(staff, id, ex.body.ticketId);
    expect(twice.status).toBe(409);
    expect(twice.body.error.message).toBe('この無料券は、もう使用済みです。画面を読み込み直してください。');
    await env.DB.prepare("UPDATE households SET status = 'merged' WHERE id = ?").bind(id).run();
    expect((await markUsed(staff, id, ex.body.ticketId)).status).toBe(409);
  });

  it('お客さんの「使用する」と「交換する」も、管理者が操作ログから元に戻せる', async () => {
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 10);
    const ex = await exchangeTicket(PAPA, { now: DAY1 });
    await useTicketOf(PAPA, { now: DAY1 });
    const useLog = (await env.DB.prepare("SELECT * FROM audit_log WHERE action = 'ticket.use'").first<AuditRow>())!;
    await getUndo('ticket.use')!(env.DB, useLog, { staffId: 1, now: new Date(DAY1) });
    expect((await me()).card.tickets).toEqual([expect.objectContaining({ id: ex.body.ticketId })]);
    // 戻した使用は、もう一度は戻せない
    await expect(getUndo('ticket.use')!(env.DB, useLog, { staffId: 1, now: new Date(DAY1) })).rejects.toThrow(/状態が変わったため戻せません/);

    const exLog = (await env.DB.prepare("SELECT * FROM audit_log WHERE action = 'ticket.exchange'").first<AuditRow>())!;
    await getUndo('ticket.exchange')!(env.DB, exLog, { staffId: 1, now: new Date(DAY1) });
    expect((await me()).card).toMatchObject({ balance: 10, tickets: [] });
    expect(await tickets()).toEqual([expect.objectContaining({ status: 'void' })]);
    await expect(getUndo('ticket.exchange')!(env.DB, exLog, { staffId: 1, now: new Date(DAY1) })).rejects.toThrow(/交換を元に戻せません/);
  });
});
