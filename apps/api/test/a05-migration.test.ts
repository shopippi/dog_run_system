import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import '../src/routes/admin/requests';
import { getUndo, type AuditRow } from '../src/services/undo';
import { adminCall, call, checkin, createStaff, dog, givePoints, login, registerUser } from './helpers';

const PAPA = 'U001:パパ';
const MAMA = 'U002:ママ';
const NOW = '2026-10-28T03:00:00Z';

async function cookieOf(role: 'staff' | 'admin' | 'developer' = 'admin') {
  await createStaff(`${role}@example.com`, role);
  return login(`${role}@example.com`);
}
async function householdIdOf(memberNo: string) {
  const r = await env.DB.prepare('SELECT id FROM households WHERE member_no = ?').bind(memberNo).first<{ id: number }>();
  return r!.id;
}
const me = (user: string, now = NOW) => call('/api/me', { user, now });
const migrate = (cookie: string, householdId: number, body: unknown, now = NOW) =>
  adminCall(`/admin/api/households/${householdId}/migrate`, { cookie, body, now });

async function setPeriod(start: string | null, end: string | null) {
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('migration_period', ?, '2026-10-01T00:00:00+09:00')")
    .bind(JSON.stringify({ start, end }))
    .run();
}

/** 旧カードの引き継ぎ申請(C-10 の形)を直接入れる */
async function insertRequest(memberNo: string, payload: unknown, createdAt = '2026-10-27T10:00:00+09:00') {
  const res = await env.DB.prepare(
    `INSERT INTO requests (kind, household_id, requester_member_id, payload, attachment_key, status, created_at)
     SELECT 'migration', h.id, (SELECT id FROM family_members WHERE household_id = h.id ORDER BY id LIMIT 1), ?, 'requests/x/card.jpg', 'pending', ?
       FROM households h WHERE h.member_no = ?`,
  )
    .bind(JSON.stringify(payload), createdAt, memberNo)
    .run();
  return res.meta.last_row_id;
}

async function lastMigrateLog(): Promise<AuditRow> {
  return (await env.DB.prepare("SELECT * FROM audit_log WHERE action = 'household.migrate' ORDER BY id DESC LIMIT 1").first<AuditRow>())!;
}

describe('A-05 旧カードの移行(受付での直接入力)', () => {
  it('台帳に「移行」と移行元を記録し、10ポイント以上になれば無料券を発行する', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 3);
    const id = await householdIdOf(r.memberNo);
    const res = await migrate(admin, id, { source: 'paper_card', points: 7 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ householdId: id, memberNo: r.memberNo, source: 'paper_card', points: 7, ticketsIssued: 1, balance: 0 });
    const card = (await me(PAPA)).body.card;
    expect(card.balance).toBe(0);
    expect(card.tickets).toHaveLength(1);
    const ledger = await env.DB.prepare(
      "SELECT delta, kind, migration_source, actor_type, actor_id FROM point_ledger WHERE kind <> 'manual' ORDER BY id",
    ).all();
    expect(ledger.results).toEqual([
      { delta: 7, kind: 'migration', migration_source: 'paper_card', actor_type: 'staff', actor_id: 1 },
      { delta: -10, kind: 'ticket_issue', migration_source: 'paper_card', actor_type: 'staff', actor_id: 1 },
    ]);
    expect(await env.DB.prepare('SELECT source, status FROM tickets').first()).toEqual({ source: 'migration', status: 'unused' });
    const log = await lastMigrateLog();
    expect(log).toMatchObject({ target_type: 'household', target_id: String(id), actor_id: 1 });
    expect(JSON.parse(log.after_value!)).toMatchObject({ points: 0, migratedPoints: 7, source: 'paper_card', ticketsIssued: 1 });
  });

  it('9ポイントまでなら無料券は出ない(境界の1つ手前)', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    const res = await migrate(admin, await householdIdOf(r.memberNo), { source: 'line_card', points: 9 });
    expect(res.body).toMatchObject({ ticketsIssued: 0, balance: 9 });
  });

  it('同じおうちの同じ移行元への2回目の移行は拒否される。別の移行元は引き継げる(19.2)', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    const id = await householdIdOf(r.memberNo);
    expect((await migrate(admin, id, { source: 'line_card', points: 4 })).status).toBe(201);
    const again = await migrate(admin, id, { source: 'line_card', points: 4 }, '2026-10-29T03:00:00Z');
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'already_migrated' });
    expect(again.body.error.message).toMatch(/LINEのショップカードの引き継ぎが10月28日に済んでいます/);
    expect((await migrate(admin, id, { source: 'paper_card', points: 2 })).status).toBe(201);
    expect((await me(PAPA)).body.card.balance).toBe(6);
    const status = await adminCall(`/admin/api/households/${id}/migration`, { cookie: admin, now: NOW });
    expect(status.body).toMatchObject({
      points: 6,
      pointsPerTicket: 10,
      migrated: { line_card: { points: 4 }, paper_card: { points: 2 } },
      inPeriod: true,
    });
  });

  it('ポイント数は0〜99。0ポイントも記録でき、その移行元は済みになる', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    const id = await householdIdOf(r.memberNo);
    for (const points of [-1, 100, 1.5]) {
      const res = await migrate(admin, id, { source: 'paper_card', points });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/ポイント数は/);
    }
    expect((await migrate(admin, id, { source: 'paper_card', points: 0 })).status).toBe(201);
    expect((await migrate(admin, id, { source: 'paper_card', points: 3 })).status).toBe(409);
    expect((await migrate(admin, id, { source: 'line_card', points: 99 })).body).toMatchObject({ ticketsIssued: 9, balance: 9 });
    const bad = await migrate(admin, id, { source: 'stamp', points: 1 });
    expect(bad.status).toBe(400);
  });

  it('移行期間の外なら 409。期間の初日と最終日は受け付ける。期間が未設定なら受け付ける', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    const id = await householdIdOf(r.memberNo);
    await setPeriod('2026-11-01', '2026-12-31');
    const before = await migrate(admin, id, { source: 'paper_card', points: 1 }, '2026-10-31T14:59:59Z');
    expect(before.status).toBe(409);
    expect(before.body.error).toMatchObject({ code: 'outside_migration_period' });
    expect(before.body.error.message).toMatch(/11月1日〜12月31日/);
    expect((await migrate(admin, id, { source: 'paper_card', points: 1 }, '2026-10-31T15:00:00Z')).status).toBe(201);
    // ログインは30日で切れるので、その日にログインし直す
    const dec = await login('admin@example.com', 'password-1234', '2026-12-31T00:00:00Z');
    expect((await migrate(dec, id, { source: 'line_card', points: 1 }, '2026-12-31T15:00:00Z')).status).toBe(409);
    expect((await migrate(dec, id, { source: 'line_card', points: 1 }, '2026-12-31T14:59:59Z')).status).toBe(201);
    const status = await adminCall(`/admin/api/households/${id}/migration`, { cookie: dec, now: '2027-01-05T03:00:00Z' });
    expect(status.body.inPeriod).toBe(false);
  });

  it('操作ログから元に戻せる。元に戻すと、同じ移行元をもう一度引き継げる', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 5);
    const id = await householdIdOf(r.memberNo);
    await migrate(admin, id, { source: 'paper_card', points: 8 });
    expect((await me(PAPA)).body.card).toMatchObject({ balance: 3, tickets: [expect.anything()] });
    await getUndo('household.migrate')!(env.DB, await lastMigrateLog(), { staffId: 1, now: new Date('2026-10-28T04:00:00Z') });
    const card = (await me(PAPA)).body.card;
    expect(card.balance).toBe(5);
    expect(card.tickets).toHaveLength(0);
    expect(await env.DB.prepare('SELECT status FROM tickets').first()).toEqual({ status: 'void' });
    // 2回は戻さない
    await expect(
      getUndo('household.migrate')!(env.DB, (await env.DB.prepare("SELECT * FROM audit_log WHERE action = 'household.migrate'").first<AuditRow>())!, {
        staffId: 1,
        now: new Date(NOW),
      }),
    ).rejects.toThrow(/すでに元に戻されています/);
    expect((await migrate(admin, id, { source: 'paper_card', points: 2 })).status).toBe(201);
    expect((await me(PAPA)).body.card.balance).toBe(7);
  });

  it('発行した無料券が使われていれば、元に戻せない', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    const id = await householdIdOf(r.memberNo);
    await migrate(admin, id, { source: 'paper_card', points: 10 });
    await checkin(PAPA, [r.dogs[0]!.id], { useTicket: true, now: '2026-10-29T01:00:00Z' });
    await expect(
      getUndo('household.migrate')!(env.DB, await lastMigrateLog(), { staffId: 1, now: new Date('2026-10-29T03:00:00Z') }),
    ).rejects.toThrow(/無料券が、もう使われている/);
  });

  it('統合済みのおうちには入力できない。統合でまとめたおうちの移行記録も数える', async () => {
    const admin = await cookieOf();
    const papa = await registerUser(PAPA);
    const mama = await registerUser(MAMA, [dog('ニコ')]);
    const keep = await householdIdOf(papa.memberNo);
    const absorb = await householdIdOf(mama.memberNo);
    await migrate(admin, absorb, { source: 'line_card', points: 3 });
    await adminCall('/admin/api/merges', { cookie: admin, body: { keepHouseholdId: keep, absorbHouseholdId: absorb }, now: NOW });
    const merged = await migrate(admin, absorb, { source: 'paper_card', points: 3 });
    expect(merged.status).toBe(409);
    expect(merged.body.error.message).toMatch(new RegExp(`${papa.memberNo} にまとめられています`));
    // 両方の移行記録を残す(5.3)。まとめたおうちで済んでいる LINE のショップカードは、2回目になる
    const status = await adminCall(`/admin/api/households/${keep}/migration`, { cookie: admin, now: NOW });
    expect(status.body.migrated.line_card).toMatchObject({ points: 3 });
    expect((await migrate(admin, keep, { source: 'line_card', points: 3 })).status).toBe(409);
    expect((await migrate(admin, keep, { source: 'paper_card', points: 3 })).status).toBe(201);
  });

  it('移行は管理者だけ。受付スタッフと製作者は 403', async () => {
    const r = await registerUser(PAPA);
    const id = await householdIdOf(r.memberNo);
    const reqId = await insertRequest(r.memberNo, { source: 'line_card', claimedPoints: 3 });
    for (const role of ['staff', 'developer'] as const) {
      const cookie = await cookieOf(role);
      expect((await migrate(cookie, id, { source: 'line_card', points: 3 })).status).toBe(403);
      expect((await adminCall(`/admin/api/requests/${reqId}/approve`, { cookie, body: { points: 3 } })).status).toBe(403);
    }
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM point_ledger WHERE kind = 'migration'").first<{ n: number }>())!.n).toBe(0);
  });
});

describe('A-05 旧カードの引き継ぎ申請の承認', () => {
  it('管理者がポイント数を確認・修正して承認すると、移行が記録され、申請は承認になる', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 5);
    const reqId = await insertRequest(r.memberNo, { source: 'line_card', claimedPoints: 8, note: '写真が少しぼやけています' });
    const list = await adminCall('/admin/api/requests', { cookie: admin });
    expect(list.body).toMatchObject({ pointsPerTicket: 10, requests: [{ id: reqId, household: { points: 5 }, migration: { claimedPoints: 8 } }] });

    const res = await adminCall(`/admin/api/requests/${reqId}/approve`, { cookie: admin, body: { points: 6 }, now: NOW });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: 'line_card', points: 6, ticketsIssued: 1, balance: 1 });
    const req = await env.DB.prepare('SELECT status, handled_by_staff_id, handle_note FROM requests WHERE id = ?').bind(reqId).first();
    expect(req).toEqual({ status: 'approved', handled_by_staff_id: 1, handle_note: '6ポイントで承認(申請は8ポイント)' });
    expect(JSON.parse((await lastMigrateLog()).after_value!)).toMatchObject({ requestId: reqId, migratedPoints: 6 });
    // 2回目の承認はできない
    expect((await adminCall(`/admin/api/requests/${reqId}/approve`, { cookie: admin, body: { points: 6 } })).status).toBe(409);
    // 操作ログから戻すと、申請は確認待ちに戻る
    await getUndo('household.migrate')!(env.DB, await lastMigrateLog(), { staffId: 1, now: new Date('2026-10-28T04:00:00Z') });
    expect(await env.DB.prepare('SELECT status FROM requests WHERE id = ?').bind(reqId).first()).toEqual({ status: 'pending' });
    expect((await me(PAPA)).body.card.balance).toBe(5);
  });

  it('同じ移行元がもう済んでいる申請は承認できず、却下を案内する。種類は承認のときに直せる', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    const id = await householdIdOf(r.memberNo);
    await migrate(admin, id, { source: 'paper_card', points: 2 });
    const reqId = await insertRequest(r.memberNo, { source: 'paper_card', claimedPoints: 2 });
    const res = await adminCall(`/admin/api/requests/${reqId}/approve`, { cookie: admin, body: { points: 2 }, now: NOW });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/「却下する」で、理由「すでに引き継ぎ済み」/);
    // 写真を見たら LINE のショップカードだった
    const fixed = await adminCall(`/admin/api/requests/${reqId}/approve`, {
      cookie: admin,
      body: { points: 2, source: 'line_card' },
      now: NOW,
    });
    expect(fixed.status).toBe(200);
    expect(fixed.body.source).toBe('line_card');
  });

  it('移行期間は申請した日で判定する。期間中の申請は、期間が終わってからでも承認できる', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    await setPeriod('2026-10-01', '2026-10-31');
    const inside = await insertRequest(r.memberNo, { source: 'paper_card', claimedPoints: 3 }, '2026-10-31T20:00:00+09:00');
    const outside = await insertRequest(r.memberNo, { source: 'line_card', claimedPoints: 3 }, '2026-11-01T09:00:00+09:00');
    const later = '2026-11-10T03:00:00Z';
    expect((await adminCall(`/admin/api/requests/${inside}/approve`, { cookie: admin, body: { points: 3 }, now: later })).status).toBe(200);
    const res = await adminCall(`/admin/api/requests/${outside}/approve`, { cookie: admin, body: { points: 3 }, now: later });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('outside_migration_period');
  });

  it('申請のあとにおうちが統合されていれば、統合先に付ける', async () => {
    const admin = await cookieOf();
    const papa = await registerUser(PAPA);
    const mama = await registerUser(MAMA, [dog('ニコ')]);
    const reqId = await insertRequest(mama.memberNo, { source: 'paper_card', claimedPoints: 4 });
    const keep = await householdIdOf(papa.memberNo);
    await adminCall('/admin/api/merges', {
      cookie: admin,
      body: { keepHouseholdId: keep, absorbHouseholdId: await householdIdOf(mama.memberNo) },
      now: NOW,
    });
    const res = await adminCall(`/admin/api/requests/${reqId}/approve`, { cookie: admin, body: { points: 4 }, now: NOW });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ householdId: keep, memberNo: papa.memberNo, balance: 4 });
    expect((await me(MAMA)).body.card.balance).toBe(4);
  });

  it('ポイント数がない・範囲の外の承認は受け付けない', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    const reqId = await insertRequest(r.memberNo, { source: 'paper_card', claimedPoints: 4 });
    expect((await adminCall(`/admin/api/requests/${reqId}/approve`, { cookie: admin, body: {} })).status).toBe(400);
    expect((await adminCall(`/admin/api/requests/${reqId}/approve`, { cookie: admin, body: { points: 100 } })).status).toBe(400);
    expect(await env.DB.prepare('SELECT status FROM requests WHERE id = ?').bind(reqId).first()).toEqual({ status: 'pending' });
  });
});
