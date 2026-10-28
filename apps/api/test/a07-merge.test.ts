import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { historyHouseholdIds } from '../src/services/merges';
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

/**
 * パパのおうち(アル、7ポイント)とママのおうち(あるくん・モカ、5ポイント)。
 * パパは 10/1、ママは 10/2 に来場している。
 */
async function seed() {
  const papa = await registerUser(PAPA, [dog('アル')]);
  const mama = await registerUser(MAMA, [dog('あるくん', { breedId: 5, size: 'medium', sex: 'male' }), dog('モカ')]);
  await checkin(PAPA, [papa.dogs[0]!.id], { now: '2026-10-01T01:00:00Z' });
  await checkin(MAMA, [mama.dogs[0]!.id, mama.dogs[1]!.id], { now: '2026-10-02T01:00:00Z' });
  await givePoints(papa.memberNo, 6);
  await givePoints(mama.memberNo, 4);
  const keepId = await householdIdOf(papa.memberNo);
  const absorbId = await householdIdOf(mama.memberNo);
  return { papa, mama, keepId, absorbId };
}

describe('A-07 おうちの統合', () => {
  it('7ポイントと5ポイントのおうちを統合すると、残高は2ポイント、無料券は1枚増える。組み合わせた2頭は1頭になり、来場記録もまとまる。30日以内なら元に戻せ、元の残高に戻る(19.2)', async () => {
    const admin = await cookieOf();
    const { papa, mama, keepId, absorbId } = await seed();
    expect((await me(PAPA)).body.card.balance).toBe(7);
    expect((await me(MAMA)).body.card.balance).toBe(5);
    const [al] = papa.dogs;
    const [aruKun, moka] = mama.dogs;
    const input = {
      keepHouseholdId: keepId,
      absorbHouseholdId: absorbId,
      dogPairs: [{ keep: al!.id, absorb: aruKun!.id, take: 'absorb' }],
    };

    // まとめた後の結果の確認(データは変えない)
    const preview = await adminCall('/admin/api/merges/preview', { cookie: admin, body: input, now: NOW });
    expect(preview.status).toBe(200);
    expect(preview.body.suggestedKeepHouseholdId).toBe(keepId);
    expect(preview.body.result).toMatchObject({
      memberNo: papa.memberNo,
      points: 2,
      tickets: 1,
      ticketsIssued: 1,
      visits: 2,
      displayName: 'あるくん・モカのおうち',
    });
    expect(preview.body.result.dogs.map((d: { name: string }) => d.name)).toEqual(['あるくん', 'モカ']);
    expect(preview.body.result.family.map((f: { name: string }) => f.name)).toEqual(['パパ', 'ママ']);
    expect((await me(MAMA)).body.card.balance).toBe(5);

    const res = await adminCall('/admin/api/merges', { cookie: admin, body: input, now: NOW });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ memberNo: papa.memberNo, points: 2, tickets: 1, ticketsIssued: 1 });

    // パパとママの会員証は、同じ会員ID・ポイント・犬になる
    const p = (await me(PAPA)).body;
    const m = (await me(MAMA)).body;
    expect(p.household.memberNo).toBe(papa.memberNo);
    expect(m.household.memberNo).toBe(papa.memberNo);
    expect(p.card.balance).toBe(2);
    expect(p.card.tickets).toHaveLength(1);
    expect(m.card.balance).toBe(2);
    expect(p.card.dogs.map((d: { id: number; name: string }) => [d.id, d.name])).toEqual([
      [al!.id, 'あるくん'],
      [moka!.id, 'モカ'],
    ]);
    // 写真・名前・犬種は選んだ方。犬IDは残す側
    expect(p.card.dogs[0]).toMatchObject({ dogNo: al!.dogNo, breedId: 5, size: 'medium', sex: 'male' });

    // まとめた会員IDは「統合済み」、まとめた犬は「統合済み」
    const absorbed = await env.DB.prepare('SELECT status, merged_into_id FROM households WHERE id = ?').bind(absorbId).first();
    expect(absorbed).toEqual({ status: 'merged', merged_into_id: keepId });
    const mergedDog = await env.DB.prepare('SELECT status, merged_into_id FROM dogs WHERE id = ?').bind(aruKun!.id).first();
    expect(mergedDog).toEqual({ status: 'merged', merged_into_id: al!.id });
    // 来場記録はすべて残す側。あるくんの来場は、アルの来場になる
    const visits = await env.DB.prepare('SELECT household_id, visit_date FROM visits ORDER BY visit_date').all();
    expect(visits.results).toEqual([
      { household_id: keepId, visit_date: '2026-10-01' },
      { household_id: keepId, visit_date: '2026-10-02' },
    ]);
    const vd = await env.DB.prepare("SELECT dog_id FROM visit_dogs WHERE visit_date = '2026-10-02' ORDER BY dog_id").all();
    expect(vd.results.map((r) => r.dog_id)).toEqual([al!.id, moka!.id]);
    // 家族の参加方法は変えない
    const mamaRow = await env.DB.prepare("SELECT household_id, join_method FROM family_members WHERE line_user_id = 'U002'").first();
    expect(mamaRow).toEqual({ household_id: keepId, join_method: 'register' });
    // 台帳: まとめた側をゼロにする行、残す側に足す行、無料券の発行
    const ledger = await env.DB.prepare('SELECT household_id, delta, kind FROM point_ledger WHERE merge_id IS NOT NULL ORDER BY id').all();
    expect(ledger.results).toEqual([
      { household_id: absorbId, delta: -5, kind: 'merge' },
      { household_id: keepId, delta: 5, kind: 'merge' },
      { household_id: keepId, delta: -10, kind: 'ticket_issue' },
    ]);
    // 犬種の変更は履歴に残る。操作ログも残る
    const changes = await env.DB.prepare('SELECT field FROM dog_changes WHERE dog_id = ? ORDER BY id').bind(al!.id).all();
    expect(changes.results.map((r) => r.field)).toEqual(['name', 'breed', 'size', 'sex']);
    const log = await env.DB.prepare("SELECT target_type, target_id FROM audit_log WHERE action = 'household.merge'").first();
    expect(log).toEqual({ target_type: 'merge', target_id: String(res.body.mergeId) });
    // 統合前の状態が残っている
    const snap = await env.DB.prepare('SELECT snapshot FROM merges WHERE id = ?').bind(res.body.mergeId).first<{ snapshot: string }>();
    expect(JSON.parse(snap!.snapshot)).toMatchObject({ balances: { kept: 7, absorbed: 5 } });
    // 使わなくなった会員IDで探すと、統合先が出る
    const search = await adminCall(`/admin/api/households?q=${mama.memberNo}`, { cookie: admin, now: NOW });
    expect(search.body.households[0]).toMatchObject({ status: 'merged', mergedIntoMemberNo: papa.memberNo });

    // 30日以内なら元に戻せ、元の残高に戻る
    const record = await adminCall(`/admin/api/merges/${res.body.mergeId}`, { cookie: admin, now: '2026-11-20T03:00:00Z' });
    expect(record.body).toMatchObject({ undoStatus: 'ok', undoDeadline: '2026-11-27T12:00:00+09:00' });
    const undo = await adminCall(`/admin/api/merges/${res.body.mergeId}/undo`, { cookie: admin, body: {}, now: '2026-11-20T03:00:00Z' });
    expect(undo.status).toBe(200);
    const p2 = (await me(PAPA)).body;
    const m2 = (await me(MAMA)).body;
    expect(p2.card.balance).toBe(7);
    expect(p2.card.tickets).toHaveLength(0);
    expect(m2.household.memberNo).toBe(mama.memberNo);
    expect(m2.card.balance).toBe(5);
    expect(p2.card.dogs.map((d: { name: string }) => d.name)).toEqual(['アル']);
    expect(p2.card.dogs[0]).toMatchObject({ breedId: 1, size: 'small', sex: null });
    expect(m2.card.dogs.map((d: { name: string }) => d.name)).toEqual(['あるくん', 'モカ']);
    const visits2 = await env.DB.prepare('SELECT household_id FROM visits ORDER BY visit_date').all();
    expect(visits2.results.map((r) => r.household_id)).toEqual([keepId, absorbId]);
    const vd2 = await env.DB.prepare("SELECT dog_id FROM visit_dogs WHERE visit_date = '2026-10-02' ORDER BY dog_id").all();
    expect(vd2.results.map((r) => r.dog_id)).toEqual([aruKun!.id, moka!.id]);
    const ticket = await env.DB.prepare("SELECT status FROM tickets WHERE source = 'merge'").first();
    expect(ticket).toEqual({ status: 'void' });
    const absorbed2 = await env.DB.prepare('SELECT status, merged_into_id FROM households WHERE id = ?').bind(absorbId).first();
    expect(absorbed2).toEqual({ status: 'active', merged_into_id: null });
    expect((await adminCall(`/admin/api/merges/${res.body.mergeId}`, { cookie: admin })).body.undoStatus).toBe('undone');
    // 2回目は戻せない
    const again = await adminCall(`/admin/api/merges/${res.body.mergeId}/undo`, { cookie: admin, body: {}, now: '2026-11-20T03:00:00Z' });
    expect(again.status).toBe(409);
  });

  it('同じ日に両方が来場していた分は、ポイントを減らさず両方の来場を残す。統合先の来場履歴からも見える', async () => {
    const admin = await cookieOf();
    const { papa, mama, keepId, absorbId } = await seed();
    await checkin(PAPA, [papa.dogs[0]!.id], { now: '2026-10-05T01:00:00Z' });
    await checkin(MAMA, [mama.dogs[0]!.id], { now: '2026-10-05T02:00:00Z' });
    const input = { keepHouseholdId: keepId, absorbHouseholdId: absorbId, dogPairs: [] };
    const preview = await adminCall('/admin/api/merges/preview', { cookie: admin, body: input, now: NOW });
    expect(preview.body.sameDayVisitDates).toEqual(['2026-10-05']);
    // 8 + 6 = 14 → 無料券1枚と4ポイント。来場は4回分
    expect(preview.body.result).toMatchObject({ points: 4, ticketsIssued: 1, visits: 4 });
    expect(preview.body.sameDayPointsRemoved).toBe(0);

    const res = await adminCall('/admin/api/merges', { cookie: admin, body: input, now: NOW });
    expect(res.status).toBe(201);
    expect((await me(MAMA)).body.card.balance).toBe(4);
    const { results } = await env.DB.prepare('SELECT household_id, visit_date FROM visits ORDER BY visit_date, id').all();
    expect(results).toEqual([
      { household_id: keepId, visit_date: '2026-10-01' },
      { household_id: keepId, visit_date: '2026-10-02' },
      { household_id: keepId, visit_date: '2026-10-05' },
      // まとめた側に残す(おうち + 来場日の一意の索引にぶつかるため)
      { household_id: absorbId, visit_date: '2026-10-05' },
    ]);
    expect(await historyHouseholdIds(env.DB, keepId)).toEqual([keepId, absorbId]);
    const snap = await env.DB.prepare('SELECT snapshot FROM merges').first<{ snapshot: string }>();
    expect(JSON.parse(snap!.snapshot).sameDayVisitIds).toHaveLength(1);

    // 元に戻すと、統合先の来場履歴には含めない
    await adminCall(`/admin/api/merges/${res.body.mergeId}/undo`, { cookie: admin, body: {}, now: NOW });
    expect(await historyHouseholdIds(env.DB, keepId)).toEqual([keepId]);
    expect((await me(MAMA)).body.card.balance).toBe(6);
  });

  it('ルールの設定で「同じ日の分のポイントを残さない」にすると、その日のまとめる側のポイントを差し引く(20章の未決事項)', async () => {
    const admin = await cookieOf();
    const { papa, mama, keepId, absorbId } = await seed();
    await checkin(PAPA, [papa.dogs[0]!.id], { now: '2026-10-05T01:00:00Z' });
    await checkin(MAMA, [mama.dogs[0]!.id], { now: '2026-10-05T02:00:00Z' });
    await env.DB.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES ('merge_keep_same_day_points', 'false', '2026-10-01T00:00:00+09:00')",
    ).run();
    const input = { keepHouseholdId: keepId, absorbHouseholdId: absorbId };
    const preview = await adminCall('/admin/api/merges/preview', { cookie: admin, body: input, now: NOW });
    // 8 + 6 - 1 = 13 → 無料券1枚と3ポイント
    expect(preview.body).toMatchObject({ sameDayPointsRemoved: 1, result: { points: 3, ticketsIssued: 1 } });
    const res = await adminCall('/admin/api/merges', { cookie: admin, body: input, now: NOW });
    expect(res.body.points).toBe(3);
    expect((await me(PAPA)).body.card.balance).toBe(3);
    // 元に戻すと、差し引いた分も戻る
    await adminCall(`/admin/api/merges/${res.body.mergeId}/undo`, { cookie: admin, body: {}, now: NOW });
    expect((await me(PAPA)).body.card.balance).toBe(8);
    expect((await me(MAMA)).body.card.balance).toBe(6);
  });

  it('統合後に来場があると元に戻せず、「製作者に依頼してください」と出る', async () => {
    const admin = await cookieOf();
    const { papa, keepId, absorbId } = await seed();
    const res = await adminCall('/admin/api/merges', {
      cookie: admin,
      body: { keepHouseholdId: keepId, absorbHouseholdId: absorbId },
      now: NOW,
    });
    await checkin(PAPA, [papa.dogs[0]!.id], { now: '2026-10-29T01:00:00Z' });
    const record = await adminCall(`/admin/api/merges/${res.body.mergeId}`, { cookie: admin, now: '2026-10-29T03:00:00Z' });
    expect(record.body.undoStatus).toBe('changed');
    const undo = await adminCall(`/admin/api/merges/${res.body.mergeId}/undo`, { cookie: admin, body: {}, now: '2026-10-29T03:00:00Z' });
    expect(undo.status).toBe(409);
    expect(undo.body.error.message).toMatch(/製作者に依頼してください/);
  });

  it('統合後にポイントの変更があっても元に戻せない', async () => {
    const admin = await cookieOf();
    const { papa, keepId, absorbId } = await seed();
    const res = await adminCall('/admin/api/merges', {
      cookie: admin,
      body: { keepHouseholdId: keepId, absorbHouseholdId: absorbId },
      now: NOW,
    });
    await env.DB.prepare(
      `INSERT INTO point_ledger (household_id, delta, kind, actor_type, created_at) VALUES (?, 1, 'manual', 'staff', '2026-10-29T10:00:00+09:00')`,
    )
      .bind(keepId)
      .run();
    void papa;
    const undo = await adminCall(`/admin/api/merges/${res.body.mergeId}/undo`, { cookie: admin, body: {}, now: '2026-10-30T03:00:00Z' });
    expect(undo.status).toBe(409);
    expect(undo.body.error.code).toBe('merge_changed_after');
  });

  it('30日を過ぎると元に戻せない(30日ちょうどまでは戻せる)', async () => {
    const admin = await cookieOf();
    const { keepId, absorbId } = await seed();
    const res = await adminCall('/admin/api/merges', {
      cookie: admin,
      body: { keepHouseholdId: keepId, absorbHouseholdId: absorbId },
      now: NOW,
    });
    const late = await adminCall(`/admin/api/merges/${res.body.mergeId}/undo`, { cookie: admin, body: {}, now: '2026-11-27T03:00:01Z' });
    expect(late.status).toBe(409);
    expect(late.body.error.message).toMatch(/30日を過ぎた.*製作者に依頼してください/);
    const justInTime = await adminCall(`/admin/api/merges/${res.body.mergeId}/undo`, { cookie: admin, body: {}, now: '2026-11-27T03:00:00Z' });
    expect(justInTime.status).toBe(200);
  });

  it('まとめる申請から統合すると、申請は承認になる。元に戻すと確認待ちに戻る', async () => {
    const admin = await cookieOf();
    const { keepId, absorbId, papa } = await seed();
    // パパの招待をママが開いた(ママはすでに別のおうちがある)
    const invite = await call('/api/invites', { user: PAPA, body: {}, now: NOW });
    const accepted = await call(`/api/invites/${invite.body.code}/accept`, { user: MAMA, body: { consent: true, survey: [] }, now: NOW });
    expect(accepted.status).toBe(202);
    const req = await env.DB.prepare("SELECT id FROM requests WHERE kind = 'merge'").first<{ id: number }>();
    const res = await adminCall('/admin/api/merges', {
      cookie: admin,
      body: { keepHouseholdId: keepId, absorbHouseholdId: absorbId, requestId: req!.id },
      now: NOW,
    });
    expect(res.status).toBe(201);
    const after = await env.DB.prepare('SELECT status, handled_by_staff_id FROM requests WHERE id = ?').bind(req!.id).first();
    expect(after).toEqual({ status: 'approved', handled_by_staff_id: 1 });
    expect((await env.DB.prepare('SELECT request_id FROM merges').first())!.request_id).toBe(req!.id);
    expect((await me(MAMA)).body.household.memberNo).toBe(papa.memberNo);

    await adminCall(`/admin/api/merges/${res.body.mergeId}/undo`, { cookie: admin, body: {}, now: NOW });
    const back = await env.DB.prepare('SELECT status, handled_at FROM requests WHERE id = ?').bind(req!.id).first();
    expect(back).toEqual({ status: 'pending', handled_at: null });
  });

  it('統合済みのおうちは、もう一度まとめられない。同じおうちどうし・違う犬の組み合わせは受け付けない', async () => {
    const admin = await cookieOf();
    const { papa, mama, keepId, absorbId } = await seed();
    const wrong = await adminCall('/admin/api/merges/preview', {
      cookie: admin,
      body: { keepHouseholdId: keepId, absorbHouseholdId: absorbId, dogPairs: [{ keep: mama.dogs[0]!.id, absorb: papa.dogs[0]!.id, take: 'keep' }] },
      now: NOW,
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.message).toMatch(/組み合わせ直して/);
    const same = await adminCall('/admin/api/merges/preview', {
      cookie: admin,
      body: { keepHouseholdId: keepId, absorbHouseholdId: keepId },
      now: NOW,
    });
    expect(same.status).toBe(400);
    expect(same.body.error.message).toMatch(/同じおうちどうし/);

    const body = { keepHouseholdId: keepId, absorbHouseholdId: absorbId };
    expect((await adminCall('/admin/api/merges', { cookie: admin, body, now: NOW })).status).toBe(201);
    const twice = await adminCall('/admin/api/merges', { cookie: admin, body, now: NOW });
    expect(twice.status).toBe(409);
    expect(twice.body.error.message).toMatch(/すでにほかのおうちにまとめられています/);
    // 台帳は1回分だけ
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM merges').first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it('統合は管理者だけ。受付スタッフと製作者は 403', async () => {
    const { keepId, absorbId } = await seed();
    const body = { keepHouseholdId: keepId, absorbHouseholdId: absorbId };
    for (const role of ['staff', 'developer'] as const) {
      const cookie = await cookieOf(role);
      expect((await adminCall('/admin/api/merges/preview', { cookie, body, now: NOW })).status).toBe(403);
      expect((await adminCall('/admin/api/merges', { cookie, body, now: NOW })).status).toBe(403);
      expect((await adminCall('/admin/api/merges/1/undo', { cookie, body: {}, now: NOW })).status).toBe(403);
    }
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM merges').first<{ n: number }>();
    expect(n!.n).toBe(0);
  });
});
