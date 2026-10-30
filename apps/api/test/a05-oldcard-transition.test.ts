import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import '../src/routes/admin/requests';
import { addFamily, adminCall, call, createStaff, dog, login, registerUser, useTicketOf } from './helpers';

/*
 * A-05 旧カードの引き継ぎ(16章)の、移行の全体を通した決まり。
 * 上限で切る・旧カードの特典から無料券・同じカードの番号・移行期間のあと・統合との関係・元に戻す・お客さんへの案内・分析
 */

const PAPA = 'U001:パパ';
const MAMA = 'U002:ママ';
const NOW = '2026-11-10T03:00:00Z';

async function cookieOf(role: 'staff' | 'admin' | 'developer' = 'admin', now = NOW) {
  await createStaff(`${role}@example.com`, role);
  return login(`${role}@example.com`, 'password-1234', now);
}
async function householdIdOf(memberNo: string) {
  return (await env.DB.prepare('SELECT id FROM households WHERE member_no = ?').bind(memberNo).first<{ id: number }>())!.id;
}
const migrate = (cookie: string, householdId: number, body: Record<string, unknown>, now = NOW) =>
  adminCall(`/admin/api/households/${householdId}/migrate`, { cookie, body: { confirmed_card: true, collected_card: true, ...body }, now });
const summary = (cookie: string, now = NOW) => adminCall('/admin/api/migrations/summary', { cookie, now });
const list = (cookie: string, q = '', now = NOW) => adminCall(`/admin/api/migrations${q ? `?q=${encodeURIComponent(q)}` : ''}`, { cookie, now });
const balanceOf = async (user: string, now = NOW) => (await call('/api/me', { user, now })).body.card.balance as number;
const oldcard = (user: string, now = NOW) => call('/api/me/oldcard', { user, now });
const undo = (cookie: string, auditId: number, now = '2026-11-10T04:00:00Z') =>
  adminCall(`/admin/api/audit/${auditId}/undo`, { cookie, body: {}, now });

async function setSetting(key: string, value: unknown) {
  await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
    .bind(key, JSON.stringify(value), '2026-10-01T00:00:00+09:00')
    .run();
}
const PERIOD = { start: '2026-11-01', end: '2026-12-31' };

describe('A-05 上限を超える旧カード', () => {
  it('旧カードのポイント数を添えると、上限までを引き継ぎ、旧カードの数と切った分を残す', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    const id = await householdIdOf(r.memberNo);
    const res = await migrate(admin, id, { source: 'paper_card', points: 30, card_points: 35 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ points: 30, cardPoints: 35, balance: 30 });
    expect(await balanceOf(PAPA)).toBe(30);
    expect((await list(admin)).body.records[0]).toMatchObject({ points: 30, cardPoints: 35 });
    expect((await summary(admin)).body.capped).toEqual({ count: 1, points: 5 });
    const log = await adminCall('/admin/api/audit', { cookie: admin, now: NOW });
    expect(log.body.entries.find((e: { actionLabel: string }) => e.actionLabel === '旧カードの引き継ぎ').detail).toBe(
      '紙のスタンプカードから30ポイント(旧カードは35ポイント)',
    );
  });

  it('上限を超える数そのものは入れられない。旧カードの数と引き継ぐ数が合わない(上限で切る以外)ときも 400', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    const id = await householdIdOf(r.memberNo);
    expect((await migrate(admin, id, { source: 'paper_card', points: 35, card_points: 35 })).body.error.message).toBe(
      '引き継げるポイントは最大30ポイントです。',
    );
    for (const [points, card] of [
      [20, 35],
      [7, 5],
      [3, 7],
    ]) {
      const res = await migrate(admin, id, { source: 'paper_card', points, card_points: card });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/旧カードのポイント数と、引き継ぐポイント数が合いません/);
    }
    expect(await balanceOf(PAPA)).toBe(0);
  });
});

describe('A-05 旧カードの特典(LINEのショップカードの特典チケットなど)', () => {
  it('使っていない特典は無料券にする(ポイントは引かない)。上限は設定(初期値1枚)', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    const id = await householdIdOf(r.memberNo);
    const over = await migrate(admin, id, { source: 'line_card', points: 4, tickets: 2 });
    expect(over.status).toBe(400);
    expect(over.body.error.message).toBe('旧カードの特典から出せる無料券は、最大1枚です。');
    const res = await migrate(admin, id, { source: 'line_card', points: 4, tickets: 1 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ points: 4, tickets: 1, balance: 4 });
    const card = (await call('/api/me', { user: PAPA, now: NOW })).body.card;
    expect(card.balance).toBe(4);
    expect(card.tickets).toHaveLength(1);
    expect(await env.DB.prepare('SELECT source, status, note FROM tickets').first()).toEqual({
      source: 'migration',
      status: 'unused',
      note: 'LINEのショップカードの特典から',
    });
    // 台帳には無料券の行を書かない(ポイントは引かない)
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM point_ledger WHERE kind = 'ticket_issue'").first<{ n: number }>())!.n).toBe(0);
    expect((await summary(admin)).body.tickets).toBe(1);
  });

  it('上限を 0 にすると特典は無料券にしない。理由と、変える場所を案内する', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    await setSetting('migration_max_tickets', 0);
    const res = await migrate(admin, await householdIdOf(r.memberNo), { source: 'line_card', points: 1, tickets: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/無料券にしない設定になっています。.*ルールの設定/);
  });

  it('元に戻すと特典から出した無料券も回収する。使われていれば元に戻せない', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    const id = await householdIdOf(r.memberNo);
    const a = await migrate(admin, id, { source: 'line_card', points: 4, tickets: 1 });
    expect((await undo(admin, a.body.auditId)).status).toBe(200);
    expect(await env.DB.prepare('SELECT status FROM tickets').first()).toEqual({ status: 'void' });
    expect((await call('/api/me', { user: PAPA, now: NOW })).body.card).toMatchObject({ balance: 0, tickets: [] });
    // もう一度入力して、無料券を使ってから元に戻そうとする
    const b = await migrate(admin, id, { source: 'line_card', points: 4, tickets: 1 }, '2026-11-10T05:00:00Z');
    expect(b.status).toBe(201);
    await useTicketOf(PAPA, { now: '2026-11-10T06:00:00Z' });
    const blocked = await undo(admin, b.body.auditId, '2026-11-10T07:00:00Z');
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/特典から出した無料券が、もう使われているため元に戻せません/);
    expect(await balanceOf(PAPA)).toBe(4);
  });
});

describe('A-05 同じカードの番号(同じカードを2つのおうちで使わない)', () => {
  it('ほかのおうちで同じ番号を引き継いでいれば 409 で知らせ、確かめたうえでなら引き継げる。一覧とまとめに出る', async () => {
    const admin = await cookieOf();
    const papa = await registerUser(PAPA);
    const mama = await registerUser(MAMA, [dog('ニコ')]);
    const a = await householdIdOf(papa.memberNo);
    const b = await householdIdOf(mama.memberNo);
    expect((await migrate(admin, a, { source: 'paper_card', points: 5, card_ref: 'No.0123' })).status).toBe(201);
    const dup = await migrate(admin, b, { source: 'paper_card', points: 5, card_ref: '０１２３' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('duplicate_card');
    expect(dup.body.error.message).toMatch(new RegExp(`カードの番号「０１２３」は、アルのおうち\\(${papa.memberNo}\\)で11月10日に引き継ぎ済みです`));
    expect(dup.body.error.details.matches).toEqual([{ memberNo: papa.memberNo, householdName: 'アルのおうち', at: '2026-11-10T12:00:00+09:00', source: 'paper_card' }]);
    expect(await balanceOf(MAMA)).toBe(0);
    // 移行元が違えば別のカード
    expect((await migrate(admin, b, { source: 'line_card', points: 2, card_ref: '0123' })).status).toBe(201);
    // 確かめたうえで
    expect((await migrate(admin, b, { source: 'paper_card', points: 5, card_ref: '０１２３', duplicate_ok: true })).status).toBe(201);
    const rows = (await list(admin)).body.records;
    expect(rows.find((x: { memberNo: string; source: string }) => x.memberNo === papa.memberNo).sameCardMemberNos).toEqual([mama.memberNo]);
    expect(rows.find((x: { memberNo: string; source: string }) => x.memberNo === mama.memberNo && x.source === 'paper_card').sameCardMemberNos).toEqual([
      papa.memberNo,
    ]);
    expect((await summary(admin)).body.sameCardGroups).toBe(1);
    const audit = await env.DB.prepare("SELECT after_value FROM audit_log WHERE action = 'household.migrate' ORDER BY id DESC LIMIT 1").first<{ after_value: string }>();
    expect(JSON.parse(audit!.after_value)).toMatchObject({ cardRef: '０１２３', sameCardMemberNos: [papa.memberNo] });
  });

  it('引き継ぎ済みの一覧は、カードの番号・会員ID・おうちの呼び名で探せる。元に戻したものは同じカードに数えない', async () => {
    const admin = await cookieOf();
    const papa = await registerUser(PAPA);
    const mama = await registerUser(MAMA, [dog('ニコ')]);
    const a = await migrate(admin, await householdIdOf(papa.memberNo), { source: 'paper_card', points: 5, card_ref: 'A-12' });
    await migrate(admin, await householdIdOf(mama.memberNo), { source: 'line_card', points: 3 });
    expect((await list(admin, 'a12')).body.records.map((x: { memberNo: string }) => x.memberNo)).toEqual([papa.memberNo]);
    expect((await list(admin, 'ニコ')).body.records.map((x: { memberNo: string }) => x.memberNo)).toEqual([mama.memberNo]);
    expect((await list(admin, mama.memberNo.slice(-3))).body.records.map((x: { memberNo: string }) => x.memberNo)).toContain(mama.memberNo);
    await undo(admin, a.body.auditId);
    expect((await migrate(admin, await householdIdOf(mama.memberNo), { source: 'paper_card', points: 5, card_ref: 'a12' })).status).toBe(201);
  });
});

describe('A-05 移行期間', () => {
  it('期間のあとは初期値では受け付けない。設定で「理由を書けば受け付ける」にすると、理由つきでだけ受け付ける', async () => {
    const admin = await cookieOf('admin', '2027-01-05T03:00:00Z');
    const r = await registerUser(PAPA);
    const id = await householdIdOf(r.memberNo);
    await setSetting('migration_period', PERIOD);
    const late = '2027-01-05T03:00:00Z';
    expect((await migrate(admin, id, { source: 'paper_card', points: 3 }, late)).body.error.code).toBe('outside_migration_period');
    await setSetting('migration_late_entry', true);
    const status = await adminCall(`/admin/api/households/${id}/migration`, { cookie: admin, now: late });
    expect(status.body).toMatchObject({ inPeriod: false, phase: 'after', lateEntry: true, maxTickets: 1 });
    const noReason = await migrate(admin, id, { source: 'paper_card', points: 3 }, late);
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.message).toMatch(/移行期間が終わっています。期間のあとに受け付ける理由を入れてください/);
    const ok = await migrate(admin, id, { source: 'paper_card', points: 3, late_reason: '入院していて来られなかった' }, late);
    expect(ok.status).toBe(201);
    expect((await list(admin, '', late)).body.records[0].lateReason).toBe('入院していて来られなかった');
    expect((await env.DB.prepare("SELECT reason FROM point_ledger WHERE kind = 'migration'").first<{ reason: string }>())!.reason).toMatch(
      /移行期間のあと: 入院していて来られなかった/,
    );
  });

  it('始まる前は、設定にかかわらず受け付けない', async () => {
    const admin = await cookieOf('admin', '2026-10-20T03:00:00Z');
    const r = await registerUser(PAPA);
    await setSetting('migration_period', PERIOD);
    await setSetting('migration_late_entry', true);
    const res = await migrate(admin, await householdIdOf(r.memberNo), { source: 'paper_card', points: 3, late_reason: 'x' }, '2026-10-20T03:00:00Z');
    expect(res.body.error.code).toBe('outside_migration_period');
  });

  it('まとめ: 引き継いだおうちの数・ポイントの合計・移行元ごと・終わりまでの日数', async () => {
    const admin = await cookieOf();
    await setSetting('migration_period', PERIOD);
    const papa = await registerUser(PAPA);
    const mama = await registerUser(MAMA, [dog('ニコ')]);
    await migrate(admin, await householdIdOf(papa.memberNo), { source: 'paper_card', points: 5 });
    await migrate(admin, await householdIdOf(papa.memberNo), { source: 'line_card', points: 7 });
    await migrate(admin, await householdIdOf(mama.memberNo), { source: 'line_card', points: 2 });
    expect((await summary(admin, '2026-12-01T03:00:00Z')).body).toEqual({
      period: PERIOD,
      phase: 'open',
      daysLeft: 30,
      households: 2,
      activeHouseholds: 2,
      points: 14,
      tickets: 0,
      capped: { count: 0, points: 0 },
      bySource: { line_card: { count: 2, points: 9 }, paper_card: { count: 1, points: 5 } },
      sameCardGroups: 0,
    });
  });
});

describe('A-05 おうちの統合との関係', () => {
  it('まとめてもポイントは二重にならず、移行元ごとに1回はまとめた後も守られる。統合を元に戻すとそれぞれに戻る', async () => {
    const admin = await cookieOf();
    const papa = await registerUser(PAPA);
    const mama = await registerUser(MAMA, [dog('ニコ')]);
    const keep = await householdIdOf(papa.memberNo);
    const absorb = await householdIdOf(mama.memberNo);
    await migrate(admin, keep, { source: 'line_card', points: 5, tickets: 1 });
    await migrate(admin, absorb, { source: 'paper_card', points: 3 });
    expect((await summary(admin)).body.households).toBe(2);
    const merged = await adminCall('/admin/api/merges', { cookie: admin, body: { keepHouseholdId: keep, absorbHouseholdId: absorb }, now: '2026-11-10T03:10:00Z' });
    expect(merged.status).toBe(201);
    // 合計は 5 + 3。移行の行は二重に数えない(統合の行で残高だけが移る)
    expect(await balanceOf(PAPA, '2026-11-10T03:11:00Z')).toBe(8);
    expect(await balanceOf(MAMA, '2026-11-10T03:11:00Z')).toBe(8);
    expect((await call('/api/me', { user: PAPA, now: '2026-11-10T03:11:00Z' })).body.card.tickets).toHaveLength(1);
    const s = await summary(admin, '2026-11-10T03:11:00Z');
    expect(s.body).toMatchObject({ households: 1, points: 8, tickets: 1 });
    // 両方の移行元が済み(まとめたおうちの分も数える)
    for (const source of ['line_card', 'paper_card']) {
      expect((await migrate(admin, keep, { source, points: 1 }, '2026-11-10T03:12:00Z')).body.error.code).toBe('already_migrated');
    }
    // お客さんにも、まとめたおうちの分の記録が見える
    expect((await oldcard(PAPA, '2026-11-10T03:12:00Z')).body.transfers.map((t: { source: string }) => t.source).sort()).toEqual(['line_card', 'paper_card']);
    // まとめた側の引き継ぎは、統合のあとは元に戻せない(ポイントの手動登録で調整するよう案内)
    const absorbedLog = await env.DB.prepare(
      "SELECT id FROM audit_log WHERE action = 'household.migrate' AND target_id = ? ORDER BY id DESC LIMIT 1",
    )
      .bind(String(absorb))
      .first<{ id: number }>();
    const blocked = await undo(admin, absorbedLog!.id, '2026-11-10T03:13:00Z');
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/統合されたため、元に戻せません/);
    // 統合を元に戻す → それぞれのおうちに戻る
    const mergeLog = await env.DB.prepare("SELECT id FROM audit_log WHERE action = 'household.merge' ORDER BY id DESC LIMIT 1").first<{ id: number }>();
    expect((await undo(admin, mergeLog!.id, '2026-11-10T03:14:00Z')).status).toBe(200);
    expect(await balanceOf(PAPA, '2026-11-10T03:15:00Z')).toBe(5);
    expect(await balanceOf(MAMA, '2026-11-10T03:15:00Z')).toBe(3);
    // 紙のカードはママのおうちで済んでいるが、パパのおうちではまだ
    expect((await migrate(admin, keep, { source: 'paper_card', points: 1 }, '2026-11-10T03:16:00Z')).status).toBe(201);
    expect((await migrate(admin, absorb, { source: 'paper_card', points: 1 }, '2026-11-10T03:16:00Z')).body.error.code).toBe('already_migrated');
  });

  it('統合のあとに引き継いだときは、統合を元に戻せない(統合後のポイントの変更。5.3)', async () => {
    const admin = await cookieOf();
    const papa = await registerUser(PAPA);
    const mama = await registerUser(MAMA, [dog('ニコ')]);
    const keep = await householdIdOf(papa.memberNo);
    const absorb = await householdIdOf(mama.memberNo);
    await adminCall('/admin/api/merges', { cookie: admin, body: { keepHouseholdId: keep, absorbHouseholdId: absorb }, now: NOW });
    await migrate(admin, keep, { source: 'line_card', points: 5 }, '2026-11-10T03:05:00Z');
    const mergeLog = await env.DB.prepare("SELECT id FROM audit_log WHERE action = 'household.merge' ORDER BY id DESC LIMIT 1").first<{ id: number }>();
    const res = await undo(admin, mergeLog!.id, '2026-11-10T03:06:00Z');
    expect(res.status).toBe(409);
    expect(await balanceOf(PAPA, '2026-11-10T03:07:00Z')).toBe(5);
  });
});

describe('A-05 登録経路・分析・権限', () => {
  it('引き継いだおうちの登録経路は「移行」になり、元に戻すと「新規」に戻る(ほかの移行元が残っていれば移行のまま)', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    const id = await householdIdOf(r.memberNo);
    const src = async () => (await env.DB.prepare('SELECT source FROM households WHERE id = ?').bind(id).first<{ source: string }>())!.source;
    expect(await src()).toBe('new');
    const a = await migrate(admin, id, { source: 'line_card', points: 2 });
    expect(await src()).toBe('migration');
    const b = await migrate(admin, id, { source: 'paper_card', points: 2 });
    await undo(admin, b.body.auditId);
    expect(await src()).toBe('migration');
    await undo(admin, a.body.auditId, '2026-11-10T04:30:00Z');
    expect(await src()).toBe('new');
  });

  it('引き継いだポイントは来場に数えない(来場の記録・日別の集計・ダッシュボードは増えない)', async () => {
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    await migrate(admin, await householdIdOf(r.memberNo), { source: 'paper_card', points: 9, tickets: 1 });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM visits').first<{ n: number }>())!.n).toBe(0);
    const stats = await env.DB.prepare('SELECT COALESCE(SUM(visit_groups), 0) AS n FROM daily_stats').first<{ n: number }>();
    expect(stats!.n).toBe(0);
    const dash = await adminCall('/admin/api/dashboard?from=2026-11-01&to=2026-11-30', { cookie: admin, now: NOW });
    expect(dash.status).toBe(200);
    expect(dash.body.totals).toMatchObject({ groups: 0, dogs: 0 });
  });

  it('製作者は一覧とまとめを見られるが、入力は 403。受付スタッフはどちらも 403', async () => {
    const r = await registerUser(PAPA);
    const id = await householdIdOf(r.memberNo);
    const dev = await cookieOf('developer');
    expect((await summary(dev)).status).toBe(200);
    expect((await list(dev)).status).toBe(200);
    expect((await migrate(dev, id, { source: 'line_card', points: 3, tickets: 1, card_ref: '1' })).status).toBe(403);
    const staff = await cookieOf('staff');
    expect((await summary(staff)).status).toBe(403);
    expect((await migrate(staff, id, { source: 'line_card', points: 3 })).status).toBe(403);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM migration_cards').first<{ n: number }>())!.n).toBe(0);
  });
});

describe('お客さんへの案内(会員証)と引き継いだ記録', () => {
  it('移行期間の中で、まだ引き継いでいなければ案内を出す。引き継ぐと出さず、記録を返す', async () => {
    const admin = await cookieOf();
    await setSetting('migration_period', PERIOD);
    const r = await registerUser(PAPA);
    expect((await oldcard(PAPA)).body).toEqual({ notice: { endDate: '2026-12-31' }, transfers: [] });
    await migrate(admin, await householdIdOf(r.memberNo), { source: 'line_card', points: 7, tickets: 1 });
    expect((await oldcard(PAPA)).body).toEqual({
      notice: null,
      transfers: [{ source: 'line_card', points: 7, tickets: 1, at: '2026-11-10T12:00:00+09:00' }],
    });
  });

  it('閉じると、その家族(LINEアカウント)には出さない。同じおうちのほかの家族には出る', async () => {
    const r = await registerUser(PAPA);
    await addFamily(r.memberNo, 'U002', 'ママ');
    expect((await call('/api/me/oldcard/close', { user: PAPA, body: {}, now: NOW })).status).toBe(200);
    expect((await oldcard(PAPA)).body.notice).toBeNull();
    expect((await oldcard(MAMA)).body.notice).toEqual({ endDate: null });
  });

  it('移行期間が終わったら出さない。元に戻した引き継ぎは記録に出さず、案内がまた出る', async () => {
    const admin = await cookieOf();
    await setSetting('migration_period', PERIOD);
    const r = await registerUser(PAPA);
    expect((await oldcard(PAPA, '2027-01-01T03:00:00Z')).body.notice).toBeNull();
    const a = await migrate(admin, await householdIdOf(r.memberNo), { source: 'paper_card', points: 2 });
    await undo(admin, a.body.auditId);
    expect((await oldcard(PAPA)).body).toEqual({ notice: { endDate: '2026-12-31' }, transfers: [] });
  });

  it('会員登録がまだの人には 409(登録を案内する)', async () => {
    const res = await oldcard('U009:だれか');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('not_registered');
  });
});
