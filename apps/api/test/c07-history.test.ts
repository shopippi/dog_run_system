import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { addFamily, adminCall, call, checkin, createStaff, dog, givePoints, login, registerUser } from './helpers';

const PAPA = 'U001:パパ';
const MAMA = 'U002:ママ';

/** 2026-10-01 から n 日目の 10:00(日本時間) */
const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n, 1, 0, 0)).toISOString();

describe('C-07 来場履歴', () => {
  it('日付・来た犬・チェックインした家族・獲得ポイント・無料券の使用を、新しい順に返す', async () => {
    const r = await registerUser(PAPA, [dog('アル'), dog('ニコ', { breedId: 5 })]);
    await addFamily(r.memberNo, 'U002', 'ママ');
    const [al, niko] = r.dogs;
    await checkin(PAPA, [al!.id, niko!.id], { now: day(0) });
    await givePoints(r.memberNo, 8); // 1 + 8 = 9 ポイント
    await checkin(MAMA, [niko!.id], { now: day(1) }); // 10ポイントになって無料券が出る
    await checkin(PAPA, [al!.id], { now: day(2), useTicket: true });

    const res = await call('/api/me/visits', { user: PAPA });
    expect(res.status).toBe(200);
    expect(res.body.next).toBeNull();
    expect(res.body.visits).toHaveLength(3);
    const [v3, v2, v1] = res.body.visits;
    expect(v3).toMatchObject({
      date: '2026-10-03',
      time: '10:00',
      checkedInBy: 'パパ',
      checkedInByMe: true,
      method: 'self',
      pointsAwarded: 1,
      usedTicket: true,
      ticketsIssued: 0,
      cancelled: false,
    });
    expect(v3.dogs.map((d: { name: string }) => d.name)).toEqual(['アル']);
    expect(v2).toMatchObject({ date: '2026-10-02', checkedInBy: 'ママ', checkedInByMe: false, pointsAwarded: 1, ticketsIssued: 1 });
    expect(v1.dogs).toEqual([
      { id: al!.id, name: 'アル', breedName: 'トイプードル', thumbUrl: null },
      { id: niko!.id, name: 'ニコ', breedName: '柴犬', thumbUrl: null },
    ]);
    // 家族が見ても同じ履歴(来場はおうちに付く)
    const mama = await call('/api/me/visits', { user: MAMA });
    expect(mama.body.visits.map((v: { id: number }) => v.id)).toEqual(res.body.visits.map((v: { id: number }) => v.id));
    expect(mama.body.visits[1].checkedInByMe).toBe(true);
  });

  it('写真がある犬は、認証つきの URL を返す', async () => {
    const r = await registerUser(PAPA);
    await env.DB.prepare("UPDATE dogs SET thumb_key = 'dogs/x/1_thumb.jpg', photo_key = 'dogs/x/1.jpg'").run();
    await checkin(PAPA, [r.dogs[0]!.id], { now: day(0) });
    const res = await call('/api/me/visits', { user: PAPA });
    expect(res.body.visits[0].dogs[0].thumbUrl).toBe('/api/media/dogs/x/1_thumb.jpg');
  });

  it('取り消した来場は「取り消し」として残り、ポイントは付いた分を返す。代理の来場は家族の名前を出さない', async () => {
    await createStaff('staff@example.com', 'staff');
    const cookie = await login('staff@example.com');
    const r = await registerUser(PAPA);
    const v = await checkin(PAPA, [r.dogs[0]!.id], { now: day(0) });
    expect((await adminCall(`/admin/api/checkins/${v.body.visitId}/cancel`, { cookie, body: { reason: '入力ミス' }, now: day(0) })).status).toBe(200);
    const h = await env.DB.prepare('SELECT id FROM households').first<{ id: number }>();
    const p = await adminCall('/admin/api/checkins/proxy', {
      cookie,
      body: { householdId: h!.id, dogIds: [r.dogs[0]!.id], useTicket: false },
      now: day(1),
    });
    expect(p.status).toBe(201);

    const res = await call('/api/me/visits', { user: PAPA });
    expect(res.body.visits).toHaveLength(2);
    expect(res.body.visits[0]).toMatchObject({ method: 'proxy', checkedInBy: null, checkedInByMe: false, cancelled: false, pointsAwarded: 1 });
    expect(res.body.visits[1]).toMatchObject({ cancelled: true, checkedInBy: 'パパ', pointsAwarded: 1 });
  });

  it('20件ずつのページ送り。日付の新しい順で、代理で後から入れた来場も日付の位置に並ぶ', async () => {
    const r = await registerUser(PAPA);
    for (let i = 0; i < 25; i++) {
      // 10/1〜10/25 の 25 日分。ただし 10/10 は最後に入れる(後から入れた来場の代わり)
      if (i === 9) continue;
      expect((await checkin(PAPA, [r.dogs[0]!.id], { now: day(i) })).status).toBe(201);
    }
    expect((await checkin(PAPA, [r.dogs[0]!.id], { now: day(9) })).status).toBe(201);

    const first = await call('/api/me/visits', { user: PAPA });
    expect(first.body.visits).toHaveLength(20);
    expect(first.body.visits[0].date).toBe('2026-10-25');
    expect(first.body.visits[19].date).toBe('2026-10-06');
    expect(first.body.next).toMatch(/^2026-10-06_\d+$/);

    const second = await call(`/api/me/visits?before=${first.body.next}`, { user: PAPA });
    expect(second.body.visits.map((v: { date: string }) => v.date)).toEqual([
      '2026-10-05',
      '2026-10-04',
      '2026-10-03',
      '2026-10-02',
      '2026-10-01',
    ]);
    expect(second.body.next).toBeNull();
    const all = [...first.body.visits, ...second.body.visits].map((v: { date: string }) => v.date);
    expect(new Set(all).size).toBe(25);
    expect(all).toContain('2026-10-10');
  });

  it('ちょうど20件のときは、次のページはない(境界値)', async () => {
    const r = await registerUser(PAPA);
    for (let i = 0; i < 20; i++) await checkin(PAPA, [r.dogs[0]!.id], { now: day(i) });
    const res = await call('/api/me/visits', { user: PAPA });
    expect(res.body.visits).toHaveLength(20);
    expect(res.body.next).toBeNull();
  });

  it('統合でまとめたおうちの来場も含める。1頭にまとめた犬は、まとめた後の犬で見せる', async () => {
    const a = await registerUser(PAPA, [dog('アル')]);
    const b = await registerUser(MAMA, [dog('あるくん'), dog('モモ')]);
    await checkin(PAPA, [a.dogs[0]!.id], { now: day(0) });
    await checkin(MAMA, [b.dogs[0]!.id, b.dogs[1]!.id], { now: day(1) });
    // 統合(担当B)の結果と同じ状態を作る: B を A にまとめ、B の「あるくん」は A の「アル」と同じ犬
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE households SET status = 'merged', merged_into_id = (SELECT id FROM households WHERE member_no = ?1)
          WHERE member_no = ?2`,
      ).bind(a.memberNo, b.memberNo),
      env.DB.prepare("UPDATE dogs SET status = 'merged', merged_into_id = ? WHERE id = ?").bind(a.dogs[0]!.id, b.dogs[0]!.id),
      env.DB.prepare(
        "UPDATE family_members SET household_id = (SELECT id FROM households WHERE member_no = ?) WHERE line_user_id = 'U002'",
      ).bind(a.memberNo),
    ]);

    const res = await call('/api/me/visits', { user: PAPA });
    expect(res.body.visits.map((v: { date: string }) => v.date)).toEqual(['2026-10-02', '2026-10-01']);
    expect(res.body.visits[0].dogs.map((d: { name: string }) => d.name)).toEqual(['アル', 'モモ']);
    expect(res.body.visits[0].checkedInBy).toBe('ママ');
  });

  it('ほかのおうちの来場は見えない', async () => {
    const r = await registerUser(PAPA);
    const o = await registerUser('U900:よその人');
    await checkin(PAPA, [r.dogs[0]!.id], { now: day(0) });
    await checkin('U900:よその人', [o.dogs[0]!.id], { now: day(0) });
    const res = await call('/api/me/visits', { user: PAPA });
    expect(res.body.visits).toHaveLength(1);
  });

  it('まだ来場がなければ空。続きの印が正しくなければ 400、未登録なら 409', async () => {
    await registerUser(PAPA);
    expect((await call('/api/me/visits', { user: PAPA })).body).toEqual({ visits: [], next: null });
    const bad = await call('/api/me/visits?before=abc', { user: PAPA });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/読み込み直して/);
    expect((await call('/api/me/visits', { user: 'U777:だれか' })).status).toBe(409);
  });
});
