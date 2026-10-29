import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import '../src/routes/admin/requests';
import { getUndo, type AuditRow } from '../src/services/undo';
import { adminCall, call, createStaff, dog, givePoints, login, registerUser, useTicketOf } from './helpers';

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
/** 直接入力。旧カードの確認の印(confirmed_card・collected_card)は、check: false のときだけ付けない */
const migrate = (cookie: string, householdId: number, body: Record<string, unknown>, now = NOW, check = true) =>
  adminCall(`/admin/api/households/${householdId}/migrate`, {
    cookie,
    body: check ? { confirmed_card: true, collected_card: true, ...body } : body,
    now,
  });
const list = (cookie: string, now = NOW) => adminCall('/admin/api/migrations', { cookie, now });

async function setPeriod(start: string | null, end: string | null) {
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('migration_period', ?, '2026-10-01T00:00:00+09:00')")
    .bind(JSON.stringify({ start, end }))
    .run();
}

/** 以前のお客さんの引き継ぎ申請(C-10 の形。いまは作られない)を直接入れる */
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

describe('A-05 旧カードの移行(受付での直接入力・対面だけ)', () => {
  it('台帳に「移行」と移行元を記録する。10ポイント以上になっても無料券には替えない(8章)。確認の印は操作ログに残る', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 3);
    const id = await householdIdOf(r.memberNo);
    const res = await migrate(admin, id, { source: 'paper_card', points: 7 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ auditId: expect.any(Number), householdId: id, memberNo: r.memberNo, source: 'paper_card', points: 7, balance: 10 });
    const card = (await me(PAPA)).body.card;
    expect(card).toMatchObject({ balance: 10, toNextTicket: 0, tickets: [] });
    const ledger = await env.DB.prepare(
      "SELECT delta, kind, migration_source, actor_type, actor_id FROM point_ledger WHERE kind <> 'manual' ORDER BY id",
    ).all();
    expect(ledger.results).toEqual([{ delta: 7, kind: 'migration', migration_source: 'paper_card', actor_type: 'staff', actor_id: 1 }]);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM tickets').first()).toEqual({ n: 0 });
    const log = await lastMigrateLog();
    expect(log).toMatchObject({ target_type: 'household', target_id: String(id), actor_id: 1 });
    expect(JSON.parse(log.after_value!)).toMatchObject({ points: 10, migratedPoints: 7, source: 'paper_card', confirmedCard: true, collectedCard: true });
    expect(await env.DB.prepare("SELECT reason FROM audit_log WHERE action = 'household.migrate'").first()).toEqual({
      reason: '紙のスタンプカードから引き継ぎ(受付で旧カードを確認)',
    });
  });

  it('「旧カードを目で確かめた」「紙のカードを回収した」の印がないと 400(記録されない)', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    const id = await householdIdOf(r.memberNo);
    for (const checks of [{}, { confirmed_card: true }, { collected_card: true }, { confirmed_card: true, collected_card: false }, { confirmed_card: 'yes', collected_card: true }]) {
      const res = await migrate(admin, id, { source: 'line_card', points: 3, ...checks }, NOW, false);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('旧カードの確認に印を付けてください。');
    }
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM point_ledger WHERE kind = 'migration'").first<{ n: number }>())!.n).toBe(0);
  });

  it('引き継げるのは最大30ポイント(初期値)。30は引き継げ、31は 400', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    const id = await householdIdOf(r.memberNo);
    const over = await migrate(admin, id, { source: 'line_card', points: 31 });
    expect(over.status).toBe(400);
    expect(over.body.error.message).toBe('引き継げるポイントは最大30ポイントです。');
    expect((await migrate(admin, id, { source: 'line_card', points: 30 })).body).toMatchObject({ points: 30, balance: 30 });
    const status = await adminCall(`/admin/api/households/${id}/migration`, { cookie: admin, now: NOW });
    expect(status.body.maxPoints).toBe(30);
  });

  it('上限は設定(migration_max_points)で変えられる', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    const id = await householdIdOf(r.memberNo);
    expect((await adminCall('/admin/api/settings', { cookie: admin, method: 'PATCH', body: { migration_max_points: 5 }, now: NOW })).status).toBe(200);
    const over = await migrate(admin, id, { source: 'line_card', points: 6 });
    expect(over.body.error.message).toBe('引き継げるポイントは最大5ポイントです。');
    expect((await migrate(admin, id, { source: 'line_card', points: 5 })).status).toBe(201);
    expect((await list(admin)).body.maxPoints).toBe(5);
  });

  it('同じおうちの同じ移行元への2回目の移行は拒否され、次にどうするかを案内する。別の移行元は引き継げる(19.2)', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    const id = await householdIdOf(r.memberNo);
    expect((await migrate(admin, id, { source: 'line_card', points: 4 })).status).toBe(201);
    const again = await migrate(admin, id, { source: 'line_card', points: 4 }, '2026-10-29T03:00:00Z');
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'already_migrated' });
    expect(again.body.error.message).toMatch(/LINEのショップカードの引き継ぎが10月28日に済んでいます。同じカードは1回だけ引き継げます。/);
    expect(again.body.error.message).toMatch(/間違えて入力したときは、「旧カードの引き継ぎ」の一覧から元に戻してから入力し直してください/);
    expect((await migrate(admin, id, { source: 'paper_card', points: 2 })).status).toBe(201);
    expect((await me(PAPA)).body.card.balance).toBe(6);
    const status = await adminCall(`/admin/api/households/${id}/migration`, { cookie: admin, now: NOW });
    expect(status.body).toMatchObject({
      points: 6,
      pointsPerTicket: 10,
      maxPoints: 30,
      migrated: { line_card: { points: 4 }, paper_card: { points: 2 } },
      inPeriod: true,
    });
  });

  it('同時に2回押されても、同じ移行元は1回だけ記録する', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    const id = await householdIdOf(r.memberNo);
    const results = await Promise.all([
      migrate(admin, id, { source: 'paper_card', points: 3 }),
      migrate(admin, id, { source: 'paper_card', points: 3 }),
    ]);
    expect(results.map((x) => x.status).sort()).toEqual([201, 409]);
    expect((await me(PAPA)).body.card.balance).toBe(3);
  });

  it('ポイント数は0以上の整数。0ポイントも記録でき、その移行元は済みになる', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    const id = await householdIdOf(r.memberNo);
    for (const points of [-1, 1.5, '3']) {
      const res = await migrate(admin, id, { source: 'paper_card', points });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/ポイント数/);
    }
    expect((await migrate(admin, id, { source: 'paper_card', points: 0 })).status).toBe(201);
    expect((await migrate(admin, id, { source: 'paper_card', points: 3 })).status).toBe(409);
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
    expect((await me(PAPA)).body.card).toMatchObject({ balance: 13, tickets: [] });
    await getUndo('household.migrate')!(env.DB, await lastMigrateLog(), { staffId: 1, now: new Date('2026-10-28T04:00:00Z') });
    expect((await me(PAPA)).body.card.balance).toBe(5);
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

  it('以前の記録で、引き継ぎで発行した無料券が使われていれば、元に戻せない', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    const id = await householdIdOf(r.memberNo);
    await migrate(admin, id, { source: 'paper_card', points: 10 });
    const at = (await lastMigrateLog()).created_at;
    // 以前の動き(引き継ぎで10ポイントになったら自動で発行)の記録を作る
    await env.DB.prepare(
      `INSERT INTO tickets (household_id, issued_at, source, status) VALUES (?, ?, 'migration', 'unused')`,
    )
      .bind(id, at)
      .run();
    await env.DB.prepare(
      `INSERT INTO point_ledger (household_id, delta, kind, ticket_id, migration_source, actor_type, actor_id, created_at)
       VALUES (?, -10, 'ticket_issue', (SELECT MAX(id) FROM tickets), 'paper_card', 'staff', 1, ?)`,
    )
      .bind(id, at)
      .run();
    await useTicketOf(PAPA, { now: '2026-10-29T01:00:00Z' });
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

  it('移行は管理者だけ。受付スタッフと製作者は 403(一覧は製作者も見られる)', async () => {
    const r = await registerUser(PAPA);
    const id = await householdIdOf(r.memberNo);
    for (const role of ['staff', 'developer'] as const) {
      const cookie = await cookieOf(role);
      expect((await migrate(cookie, id, { source: 'line_card', points: 3 })).status).toBe(403);
      expect((await list(cookie)).status).toBe(role === 'staff' ? 403 : 200);
    }
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM point_ledger WHERE kind = 'migration'").first<{ n: number }>())!.n).toBe(0);
  });
});

describe('A-05 引き継ぎ済みの一覧', () => {
  it('いつ・誰が・どのおうちに・何ポイントを、新しい順に返す', async () => {
    const admin = await cookieOf();
    const papa = await registerUser(PAPA);
    const mama = await registerUser(MAMA, [dog('ニコ')]);
    await migrate(admin, await householdIdOf(papa.memberNo), { source: 'line_card', points: 4 }, '2026-10-28T01:00:00Z');
    await migrate(admin, await householdIdOf(mama.memberNo), { source: 'paper_card', points: 9 }, '2026-10-28T02:00:00Z');
    const res = await list(admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      maxPoints: 30,
      records: [
        {
          auditId: expect.any(Number),
          at: '2026-10-28T11:00:00+09:00',
          staffName: '管理者',
          householdId: await householdIdOf(mama.memberNo),
          memberNo: mama.memberNo,
          householdName: 'ニコのおうち',
          source: 'paper_card',
          points: 9,
          undone: null,
        },
        expect.objectContaining({ at: '2026-10-28T10:00:00+09:00', memberNo: papa.memberNo, source: 'line_card', points: 4, undone: null }),
      ],
    });
  });

  it('一覧の「元に戻す」(操作ログの元に戻すと同じ)で戻すと、戻した印が付き、もう一度入力できる', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    const id = await householdIdOf(r.memberNo);
    await migrate(admin, id, { source: 'line_card', points: 4 });
    const before = await list(admin);
    const undo = await adminCall(`/admin/api/audit/${before.body.records[0].auditId}/undo`, { cookie: admin, body: {}, now: '2026-10-28T04:00:00Z' });
    expect(undo.status).toBe(200);
    const after = await list(admin);
    expect(after.body.records[0]).toMatchObject({ points: 4, undone: { at: '2026-10-28T13:00:00+09:00', byName: '管理者' } });
    expect((await me(PAPA)).body.card.balance).toBe(0);
    expect((await migrate(admin, id, { source: 'line_card', points: 5 })).status).toBe(201);
    expect((await list(admin)).body.records.map((x: { points: number; undone: unknown }) => [x.points, x.undone === null])).toEqual([
      [5, true],
      [4, false],
    ]);
    // 操作ログの言葉
    const log = await adminCall('/admin/api/audit', { cookie: admin });
    expect(log.body.entries.find((e: { actionLabel: string }) => e.actionLabel === '旧カードの引き継ぎ')).toMatchObject({
      detail: 'LINEのショップカードから5ポイント',
    });
  });
});

describe('A-05 以前に届いた引き継ぎの申請(C-10 はやめた)', () => {
  it('お客さんの申請はもう作れない(404)。以前の申請は承認できず、却下して受付で入力するよう案内する', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    const created = await call('/api/requests', { user: PAPA, body: {}, now: NOW });
    expect(created.status).toBe(404);
    expect((await call('/api/requests', { user: PAPA, now: NOW })).status).toBe(404);
    const reqId = await insertRequest(r.memberNo, { source: 'line_card', claimedPoints: 8 });
    const res = await adminCall(`/admin/api/requests/${reqId}/approve`, { cookie: admin, body: { points: 8 }, now: NOW });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'migration_in_person' });
    expect(res.body.error.message).toMatch(/「却下する」で処理し、お客さんに受付で旧カードを見せてもらってください/);
    expect((await me(PAPA)).body.card.balance).toBe(0);
    // 以前の申請のデータは消さず、却下できる
    const rejected = await adminCall(`/admin/api/requests/${reqId}/reject`, { cookie: admin, body: { reason: 'その他' }, now: NOW });
    expect(rejected.status).toBe(200);
    expect(await env.DB.prepare('SELECT kind, status FROM requests WHERE id = ?').bind(reqId).first()).toEqual({ kind: 'migration', status: 'rejected' });
  });
});
