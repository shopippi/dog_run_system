import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { addFamily, adminCall, call, checkin, createStaff, exchangeTicket, givePoints, login, registerUser } from './helpers';

// 2026-10-29 管理画面のトーストの「元に戻す」(docs/design.md 11.4)。
// 元に戻せる操作の応答に、操作ログの番号(auditId)が入り、その番号で操作ログから元に戻せる

const PAPA = 'U001:パパ';
const MAMA = 'U002:ママ';
const NOW = '2026-10-28T03:00:00Z';

async function setup() {
  await createStaff('staff@example.com', 'staff');
  await createStaff('admin@example.com', 'admin');
  const r = await registerUser(PAPA);
  const id = (await env.DB.prepare('SELECT id FROM households WHERE member_no = ?').bind(r.memberNo).first<{ id: number }>())!.id;
  return { r, id, staff: await login('staff@example.com'), admin: await login('admin@example.com') };
}
const undo = (cookie: string, auditId: number) => adminCall(`/admin/api/audit/${auditId}/undo`, { cookie, body: {}, now: NOW });
const balance = async () => (await call('/api/me', { user: PAPA, now: NOW })).body.card.balance as number;
const actionOf = async (auditId: number) =>
  (await env.DB.prepare('SELECT action FROM audit_log WHERE id = ?').bind(auditId).first<{ action: string }>())?.action;

describe('トーストの「元に戻す」に使う操作ログの番号', () => {
  it('チェックインの取り消し: 応答の auditId で元に戻すと、ポイントが戻る。受付スタッフの取り消しにも番号は付く(戻せるのは管理者だけ)', async () => {
    const s = await setup();
    const v = await checkin(PAPA, [s.r.dogs[0]!.id], { now: NOW });
    expect(await balance()).toBe(1);
    const res = await adminCall(`/admin/api/checkins/${v.body.visitId}/cancel`, { cookie: s.staff, body: { reason: '入力ミス' }, now: NOW });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.auditId).toBe('number');
    expect(await actionOf(res.body.auditId)).toBe('visit.cancel');
    expect(await balance()).toBe(0);
    // 受付スタッフは操作ログから戻せない(権限は API で確かめる)
    expect((await undo(s.staff, res.body.auditId)).status).toBe(403);
    expect((await undo(s.admin, res.body.auditId)).status).toBe(200);
    expect(await balance()).toBe(1);
  });

  it('ポイントの手動登録: 応答に auditId が入り、元に戻すと残高が戻る', async () => {
    const s = await setup();
    const res = await adminCall(`/admin/api/households/${s.id}/points`, {
      cookie: s.admin,
      body: { points: 3, tickets: 0, reason: 'イベントの特典' },
      now: NOW,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ balanceBefore: 0, balanceAfter: 3 });
    expect(await actionOf(res.body.auditId)).toBe('points.manual');
    expect(await balance()).toBe(3);
    expect((await undo(s.admin, res.body.auditId)).status).toBe(200);
    expect(await balance()).toBe(0);
  });

  it('旧カードの引き継ぎ: 応答に auditId が入り、元に戻すとポイントが戻る', async () => {
    const s = await setup();
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('migration_period', ?, '2026-10-01T00:00:00+09:00')")
      .bind(JSON.stringify({ start: '2026-10-01', end: '2026-12-31' }))
      .run();
    const res = await adminCall(`/admin/api/households/${s.id}/migrate`, {
      cookie: s.admin,
      body: {
        source: 'line_card',
        points: 5,
        confirmed_card: true,
        collected_card: true,
        member_id: (await env.DB.prepare('SELECT id FROM family_members WHERE household_id = ? ORDER BY id LIMIT 1').bind(s.id).first<{ id: number }>())!.id,
      },
      now: NOW,
    });
    expect(res.status).toBe(201);
    expect(await actionOf(res.body.auditId)).toBe('household.migrate');
    expect(await balance()).toBe(5);
    expect((await undo(s.admin, res.body.auditId)).status).toBe(200);
    expect(await balance()).toBe(0);
  });

  it('無料券を使用済みにする: 応答に auditId が入り、元に戻すと未使用に戻る', async () => {
    const s = await setup();
    await givePoints(s.r.memberNo, 10);
    const t = await exchangeTicket(PAPA, { now: NOW });
    const res = await adminCall(`/admin/api/households/${s.id}/tickets/${t.body.ticketId}/use`, { cookie: s.staff, body: {}, now: NOW });
    expect(res.status).toBe(200);
    expect(await actionOf(res.body.auditId)).toBe('ticket.mark_used');
    expect((await undo(s.admin, res.body.auditId)).status).toBe(200);
    const row = await env.DB.prepare('SELECT status FROM tickets WHERE id = ?').bind(t.body.ticketId).first<{ status: string }>();
    expect(row?.status).toBe('unused');
  });

  it('家族を外す: 応答に auditId が入り、元に戻すと家族に戻る', async () => {
    const s = await setup();
    await addFamily(s.r.memberNo, MAMA.split(':')[0]!, 'ママ');
    const mama = (await env.DB.prepare("SELECT id FROM family_members WHERE line_user_id = 'U002'").first<{ id: number }>())!.id;
    const res = await adminCall(`/admin/api/households/${s.id}/family/${mama}`, { cookie: s.admin, method: 'DELETE', now: NOW });
    expect(res.status).toBe(200);
    expect(await actionOf(res.body.auditId)).toBe('family.remove');
    expect((await undo(s.admin, res.body.auditId)).status).toBe(200);
    const row = await env.DB.prepare('SELECT status FROM family_members WHERE id = ?').bind(mama).first<{ status: string }>();
    expect(row?.status).toBe('active');
  });
});
