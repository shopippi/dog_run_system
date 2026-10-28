import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { addFamily, adminCall, call, checkin, createStaff, dog, givePoints, login, registerUser, survey } from './helpers';

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
const householdId = async (memberNo: string) =>
  (await env.DB.prepare('SELECT id FROM households WHERE member_no = ?').bind(memberNo).first<{ id: number }>())!.id;
const detail = (cookie: string, id: number, now = DAY2) => adminCall(`/admin/api/households/${id}`, { cookie, now });
const rename = (cookie: string, id: number, displayName: string) =>
  adminCall(`/admin/api/households/${id}`, { cookie, method: 'PATCH', body: { displayName }, now: DAY2 });

describe('A-02 おうちの詳細', () => {
  it('家族・犬・来場履歴・アンケート・ポイントの記録・無料券・残高を返す', async () => {
    const c = await cookies();
    // 管理者が追加した質問(おうち向け)
    await env.DB.prepare(
      `INSERT INTO survey_questions (target, kind, label, options, required, sort_order, created_at)
       VALUES ('household', 'text', '来てほしいイベント', '[]', 0, 60, '2026-10-01T00:00:00+09:00')`,
    ).run();
    const r = await registerUser(PAPA, [dog('アル'), dog('ニコ', { breedId: 5, size: 'medium', sex: 'female', birthYm: '2020-04' })], {
      survey: survey([
        { questionId: 3, value: '1500001' },
        { questionId: 10, value: '誕生日会' }, // 6〜9 は固定の質問(来たい時間帯など)
      ]),
    });
    await addFamily(r.memberNo, 'U002', 'ママ');
    await givePoints(r.memberNo, 9);
    await checkin(PAPA, [r.dogs[0]!.id, r.dogs[1]!.id], { now: DAY1 });
    const v2 = await checkin(PAPA, [r.dogs[1]!.id], { now: DAY2, useTicket: true });
    await adminCall(`/admin/api/checkins/${v2.body.visitId}/cancel`, { cookie: c.staff, body: { reason: '入力ミス' }, now: DAY2 });

    const res = await detail(c.admin, await householdId(r.memberNo));
    expect(res.status).toBe(200);
    const d = res.body;
    expect(d).toMatchObject({
      memberNo: r.memberNo,
      displayName: 'アル・ニコのおうち',
      displayNameAuto: true,
      status: 'active',
      statusLabel: '利用中',
      sourceLabel: '新規の登録',
      mergedInto: null,
      balance: 0,
      usableTickets: 1,
      pointsPerTicket: 10,
      toNextTicket: 10,
      visitCount: 1,
    });
    expect(d.family).toEqual([
      expect.objectContaining({ name: 'ママ', joinMethodLabel: '招待で参加' }),
      expect.objectContaining({ name: 'パパ', ageGroup: '30代', gender: '女性', joinMethodLabel: 'はじめに登録', statusLabel: '参加中' }),
    ]);
    expect(d.dogs.map((x: any) => [x.name, x.breedName, x.size, x.sex, x.birthYm])).toEqual([
      ['アル', 'プードル', 'small', null, null],
      ['ニコ', '柴犬', 'medium', 'female', '2020-04'],
    ]);
    expect(d.visits).toEqual([
      expect.objectContaining({ date: '2026-10-29', dogs: [{ id: r.dogs[1]!.id, name: 'ニコ' }], cancelled: true, cancelReason: '入力ミス', usedTicket: true }),
      expect.objectContaining({ date: '2026-10-28', time: '10:00', points: 1, checkedInBy: 'パパ', methodLabel: 'ご本人', cancelled: false }),
    ]);
    expect(d.ledger.map((l: any) => [l.delta, l.kindLabel])).toEqual([
      [-1, '来場の取り消し'],
      [1, '来場'],
      [-10, '無料券の発行'],
      [1, '来場'],
      [9, '手動で調整'],
    ]);
    expect(d.tickets).toEqual([expect.objectContaining({ status: 'unused', statusLabel: '未使用', sourceLabel: 'ポイントがたまって発行' })]);
    expect(d.survey.household).toEqual([
      { label: 'お住まいの郵便番号', answer: '1500001' },
      { label: 'このドッグランを知ったきっかけ', answer: 'Instagram' },
      { label: 'ふだんの来場手段', answer: null },
      { label: '来たい時間帯', answer: null },
      { label: '興味のあるイベント', answer: null },
      { label: 'ほかのドッグランも使っていますか', answer: null },
      { label: 'お知らせをLINEで受け取りますか', answer: null },
      { label: '来てほしいイベント', answer: '誕生日会' },
    ]);
    expect(d.survey.members[1]).toEqual({
      memberId: expect.any(Number),
      name: 'パパ',
      answers: [
        { label: '年代', answer: '30代' },
        { label: '性別', answer: '女性' },
      ],
    });
  });

  it('受付スタッフは 403。製作者は見られる。見つからないおうちは 404', async () => {
    const c = await cookies();
    const r = await registerUser(PAPA);
    const id = await householdId(r.memberNo);
    expect((await detail(c.staff, id)).status).toBe(403);
    const dev = await detail(c.dev, id);
    expect(dev.status).toBe(200);
    expect(dev.body.survey).not.toBeNull();
    const nf = await detail(c.admin, 999);
    expect(nf.status).toBe(404);
    expect(nf.body.error.message).toMatch(/おうちを探す画面から/);
  });

  it('統合済みのおうちは、統合先を返す。呼び名は変えられない', async () => {
    const c = await cookies();
    const a = await registerUser(PAPA);
    const b = await registerUser('U009:ママ', [dog('ニコ')]);
    const aId = await householdId(a.memberNo);
    const bId = await householdId(b.memberNo);
    await env.DB.prepare("UPDATE households SET status = 'merged', merged_into_id = ? WHERE id = ?").bind(aId, bId).run();
    const res = await detail(c.admin, bId);
    expect(res.body).toMatchObject({ status: 'merged', statusLabel: '統合済み', mergedInto: { id: aId, memberNo: a.memberNo, displayName: 'アルのおうち' } });
    const ren = await rename(c.admin, bId, '新しい名前');
    expect(ren.status).toBe(409);
    expect(ren.body.error.message).toMatch(/まとめた先のおうちを開いて/);
  });
});

describe('A-02 呼び名の変更', () => {
  it('呼び名を変えると自動で作らなくなり、新しい呼び名で探せる。操作ログに残り、元に戻せる', async () => {
    const c = await cookies();
    const r = await registerUser(PAPA);
    const id = await householdId(r.memberNo);
    const res = await rename(c.admin, id, '  アルくんのおうち ');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ displayName: 'アルくんのおうち', displayNameAuto: false });
    const found = await adminCall(`/admin/api/households?q=${encodeURIComponent('あるくん')}`, { cookie: c.staff });
    expect(found.body.households.map((h: any) => h.id)).toEqual([id]);

    // 犬を追加しても、自分で付けた呼び名は変わらない
    await call('/api/dogs', { user: PAPA, body: dog('ニコ'), now: DAY2 });
    expect((await detail(c.admin, id)).body.displayName).toBe('アルくんのおうち');
    const log = await adminCall('/admin/api/audit', { cookie: c.admin });
    expect(log.body.entries[0]).toMatchObject({
      actionLabel: 'おうちの呼び名の変更',
      target: { label: 'アルくんのおうち', code: r.memberNo, householdId: id },
      detail: '「アルのおうち」(自動) → 「アルくんのおうち」',
      canUndo: true,
    });
    const undo = await adminCall(`/admin/api/audit/${log.body.entries[0].id}/undo`, { cookie: c.admin, body: {}, now: DAY2 });
    expect(undo.status).toBe(200);
    const back = await detail(c.admin, id);
    // 自動の呼び名に戻り、今の犬の名前から作り直される
    expect(back.body).toMatchObject({ displayName: 'アル・ニコのおうち', displayNameAuto: true });
  });

  it('空にすると、犬の名前から作る呼び名に戻る', async () => {
    const c = await cookies();
    const r = await registerUser(PAPA, [dog('アル'), dog('ニコ')]);
    const id = await householdId(r.memberNo);
    await rename(c.admin, id, 'ふじさん家');
    const res = await rename(c.admin, id, '   ');
    expect(res.body).toMatchObject({ displayName: 'アル・ニコのおうち', displayNameAuto: true });
    const found = await adminCall(`/admin/api/households?q=${encodeURIComponent('にこ')}`, { cookie: c.staff });
    expect(found.body.households[0].displayName).toBe('アル・ニコのおうち');
  });

  it('その後にまた変えていたら、前の変更は元に戻せない(409)', async () => {
    const c = await cookies();
    const r = await registerUser(PAPA);
    const id = await householdId(r.memberNo);
    await rename(c.admin, id, 'A');
    await rename(c.admin, id, 'B');
    const first = (await env.DB.prepare("SELECT id FROM audit_log WHERE action = 'household.rename' ORDER BY id").first<{ id: number }>())!.id;
    const res = await adminCall(`/admin/api/audit/${first}/undo`, { cookie: c.admin, body: {}, now: DAY2 });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/また変えられているため/);
  });

  it('40文字を超える呼び名は 400。受付スタッフと製作者は 403', async () => {
    const c = await cookies();
    const r = await registerUser(PAPA);
    const id = await householdId(r.memberNo);
    expect((await rename(c.admin, id, 'あ'.repeat(40))).status).toBe(200);
    const long = await rename(c.admin, id, 'あ'.repeat(41));
    expect(long.status).toBe(400);
    expect(long.body.error.message).toBe('呼び名は40文字までで入力してください。');
    expect((await rename(c.staff, id, 'X')).status).toBe(403);
    expect((await rename(c.dev, id, 'X')).status).toBe(403);
  });
});
