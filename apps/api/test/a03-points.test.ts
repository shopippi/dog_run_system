import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { adminCall, call, checkin, createStaff, givePoints, login, registerUser } from './helpers';

const PAPA = 'U001:パパ';
const DAY1 = '2026-10-28T01:00:00Z';
const DAY2 = '2026-10-29T01:00:00Z';

async function setup() {
  await createStaff('staff@example.com', 'staff');
  await createStaff('admin@example.com', 'admin');
  await createStaff('dev@example.com', 'developer');
  const r = await registerUser(PAPA);
  const id = (await env.DB.prepare('SELECT id FROM households WHERE member_no = ?').bind(r.memberNo).first<{ id: number }>())!.id;
  return {
    r,
    id,
    staff: await login('staff@example.com'),
    admin: await login('admin@example.com'),
    dev: await login('dev@example.com'),
  };
}
const points = (cookie: string, id: number, body: Record<string, unknown>, now = DAY1) =>
  adminCall(`/admin/api/households/${id}/points`, { cookie, body: { tickets: 0, points: 0, ...body }, now });
const preview = (cookie: string, id: number, body: Record<string, unknown>) =>
  adminCall(`/admin/api/households/${id}/points/preview`, { cookie, body: { tickets: 0, points: 0, ...body }, now: DAY1 });
const card = async (now = DAY1) => (await call('/api/me', { user: PAPA, now })).body.card;
const lastLog = async () =>
  (await env.DB.prepare("SELECT id FROM audit_log WHERE action = 'points.manual' ORDER BY id DESC").first<{ id: number }>())!.id;
const undo = (cookie: string, id: number, now = DAY1) => adminCall(`/admin/api/audit/${id}/undo`, { cookie, body: {}, now });

describe('A-03 ポイントの手動登録', () => {
  it('19.2: ポイントを手動で増やすと、理由が操作ログに残り、操作ログから元に戻せる', async () => {
    const s = await setup();
    const res = await points(s.admin, s.id, { points: 1, reason: 'イベントの特典' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ balanceBefore: 0, balanceAfter: 1, ticketsBefore: 0, ticketsAfter: 0, ticketsIssued: 0, pointsPerTicket: 10 });
    expect((await card()).balance).toBe(1);
    const ledger = await env.DB.prepare("SELECT delta, kind, reason, actor_type, actor_id FROM point_ledger WHERE kind = 'manual'").first();
    expect(ledger).toEqual({ delta: 1, kind: 'manual', reason: 'イベントの特典', actor_type: 'staff', actor_id: 2 });

    const log = await adminCall('/admin/api/audit', { cookie: s.admin });
    expect(log.body.entries[0]).toMatchObject({
      actorName: '管理者',
      actionLabel: 'ポイント・無料券の手動登録',
      target: { label: 'アルのおうち', code: s.r.memberNo },
      detail: 'ポイント +1',
      reason: 'イベントの特典',
      canUndo: true,
    });
    const u = await undo(s.admin, log.body.entries[0].id);
    expect(u.status).toBe(200);
    expect((await card()).balance).toBe(0);
    const detail = await adminCall(`/admin/api/households/${s.id}`, { cookie: s.admin });
    expect(detail.body.ledger.map((l: any) => [l.delta, l.kindLabel, l.reason])).toEqual([
      [-1, '手動で調整', '操作ログから元に戻した'],
      [1, '手動で調整', 'イベントの特典'],
    ]);
  });

  it('9 ポイントに 1 足すと無料券を発行して 0 ポイント。元に戻すと券は取り消され 9 ポイントに戻る', async () => {
    const s = await setup();
    await givePoints(s.r.memberNo, 9);
    const res = await points(s.admin, s.id, { points: 1, reason: 'お詫び', note: '待たせた' });
    expect(res.body).toMatchObject({ balanceAfter: 0, ticketsAfter: 1, ticketsIssued: 1 });
    expect(await card()).toMatchObject({ balance: 0 });
    expect((await card()).tickets).toHaveLength(1);
    const t = await env.DB.prepare('SELECT source, status FROM tickets').first();
    expect(t).toEqual({ source: 'points', status: 'unused' });

    expect((await undo(s.admin, await lastLog())).status).toBe(200);
    expect(await card()).toMatchObject({ balance: 9, tickets: [] });
    expect(await env.DB.prepare('SELECT status FROM tickets').first()).toEqual({ status: 'void' });
  });

  it('プレビューは書き込まずに、変更後の残高と無料券を返す', async () => {
    const s = await setup();
    await givePoints(s.r.memberNo, 8);
    const res = await preview(s.admin, s.id, { points: 15, tickets: 1, reason: 'その他', note: '紙のカードの分' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ balanceBefore: 8, balanceAfter: 3, ticketsBefore: 0, ticketsAfter: 3, ticketsIssued: 2, pointsPerTicket: 10 });
    expect((await card()).balance).toBe(8);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_log').first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it('残高がマイナスになる減らし方、持っている枚数を超える無料券の減らし方は 409', async () => {
    const s = await setup();
    await givePoints(s.r.memberNo, 3);
    const neg = await points(s.admin, s.id, { points: -4, reason: '入力ミスの修正' });
    expect(neg.status).toBe(409);
    expect(neg.body.error.message).toMatch(/ポイントは3しかないため/);
    expect((await preview(s.admin, s.id, { points: -4, reason: '入力ミスの修正' })).status).toBe(409);
    expect((await points(s.admin, s.id, { points: -3, reason: '入力ミスの修正' })).status).toBe(201);
    expect((await card()).balance).toBe(0);
    const t = await points(s.admin, s.id, { tickets: -1, reason: '入力ミスの修正' });
    expect(t.status).toBe(409);
    expect(t.body.error.message).toMatch(/使える無料券は0枚しかない/);
  });

  it('無料券を増やす・減らす(減らした券は取り消しになり、元に戻すと未使用に戻る)', async () => {
    const s = await setup();
    await points(s.admin, s.id, { tickets: 2, reason: 'イベントの特典' });
    expect((await card()).tickets).toHaveLength(2);
    const sources = await env.DB.prepare("SELECT source, note FROM tickets WHERE status = 'unused'").all();
    expect(sources.results).toEqual([
      { source: 'manual', note: 'イベントの特典' },
      { source: 'manual', note: 'イベントの特典' },
    ]);
    await points(s.admin, s.id, { tickets: -1, reason: '入力ミスの修正' });
    expect((await card()).tickets).toHaveLength(1);
    expect((await undo(s.admin, await lastLog())).status).toBe(200);
    expect((await card()).tickets).toHaveLength(2);
    // 最初に増やした分を戻す
    const first = (await env.DB.prepare("SELECT id FROM audit_log WHERE action = 'points.manual' ORDER BY id").first<{ id: number }>())!.id;
    expect((await undo(s.admin, first)).status).toBe(200);
    expect((await card()).tickets).toHaveLength(0);
  });

  it('増やした無料券がもう使われていたら、元に戻せない(409)', async () => {
    const s = await setup();
    await points(s.admin, s.id, { tickets: 1, reason: 'お詫び' });
    await checkin(PAPA, [s.r.dogs[0]!.id], { now: DAY2, useTicket: true });
    const res = await undo(s.admin, await lastLog(), DAY2);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/もう使われているため戻せません/);
  });

  it('その後にポイントを使って、戻すとマイナスになるときは元に戻せない(409)', async () => {
    const s = await setup();
    await points(s.admin, s.id, { points: 3, reason: 'お詫び' });
    const first = await lastLog();
    await points(s.admin, s.id, { points: -2, reason: '入力ミスの修正' });
    const res = await undo(s.admin, first);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/ポイントが足りなくなります/);
  });

  it('減らした分を戻して 10 以上になったら、無料券を発行する', async () => {
    const s = await setup();
    await givePoints(s.r.memberNo, 9);
    await points(s.admin, s.id, { points: -5, reason: '入力ミスの修正' });
    await checkin(PAPA, [s.r.dogs[0]!.id], { now: DAY2 });
    expect((await card(DAY2)).balance).toBe(5);
    const first = (await env.DB.prepare("SELECT id FROM audit_log WHERE action = 'points.manual'").first<{ id: number }>())!.id;
    expect((await undo(s.admin, first, DAY2)).status).toBe(200);
    expect(await card(DAY2)).toMatchObject({ balance: 0 });
    expect((await card(DAY2)).tickets).toHaveLength(1);
  });

  it('入力のまちがいは 400。受付スタッフと製作者は 403', async () => {
    const s = await setup();
    const other = await points(s.admin, s.id, { points: 1, reason: 'その他' });
    expect(other.status).toBe(400);
    expect(other.body.error.message).toBe('「その他」を選んだときは、理由の内容を入力してください。');
    expect((await points(s.admin, s.id, { reason: 'お詫び' })).status).toBe(400);
    expect((await points(s.staff, s.id, { points: 1, reason: 'お詫び' })).status).toBe(403);
    expect((await points(s.dev, s.id, { points: 1, reason: 'お詫び' })).status).toBe(403);
    expect((await preview(s.staff, s.id, { points: 1, reason: 'お詫び' })).status).toBe(403);
    expect((await points(s.admin, 999, { points: 1, reason: 'お詫び' })).status).toBe(404);
  });
});
