import { describe, expect, it } from 'vitest';
import { addFamily, call, checkin, dog, givePoints, registerUser } from './helpers';

// 犬を飼っている人の気持ちに寄り添う小さな記念(docs/design.md 13章)。
// 今日のスタンプ・来場の回数の節目・ワンちゃんごとの来場の記録。どれも、おうち(会員ID)の来場から数える。

const PAPA = 'U001:パパ';
const day = (d: number) => `2026-10-${String(d).padStart(2, '0')}T01:00:00Z`;

describe('C-14 小さな記念', () => {
  it('会員証は、今日の来場で付いたポイントを返す(今日のスタンプの色を変えるため)', async () => {
    const r = await registerUser(PAPA, [dog('アル')]);
    await givePoints(r.memberNo, 3);
    expect((await call('/api/me', { user: PAPA, now: day(10) })).body.card.todayPoints).toBe(0);
    await checkin(PAPA, [r.dogs[0]!.id], { now: day(10) });
    expect((await call('/api/me', { user: PAPA, now: day(10) })).body.card.todayPoints).toBe(1);
    // 家族が開いても同じ(おうちの来場)
    await addFamily(r.memberNo, 'U002', 'ママ');
    expect((await call('/api/me', { user: 'U002:ママ', now: day(10) })).body.card.todayPoints).toBe(1);
    // 次の日は 0
    expect((await call('/api/me', { user: PAPA, now: day(11) })).body.card.todayPoints).toBe(0);
  });

  it('チェックイン完了は、おうちの何回目の来場かを返す(取り消した来場は数えない)', async () => {
    const r = await registerUser(PAPA, [dog('アル')]);
    let last = 0;
    for (let d = 1; d <= 10; d++) {
      const done = await checkin(PAPA, [r.dogs[0]!.id], { now: day(d) });
      expect(done.status).toBe(201);
      last = done.body.visitId;
    }
    const res = await call(`/api/checkins/${last}`, { user: PAPA, now: day(10) });
    expect(res.body.visitCount).toBe(10);
  });

  it('ワンちゃんの一覧は、その子の来場の回数と最後に来た日を返す', async () => {
    const r = await registerUser(PAPA, [dog('アル'), dog('ニコ')]);
    const [al, niko] = r.dogs as { id: number }[];
    await checkin(PAPA, [al!.id, niko!.id], { now: day(3) });
    await checkin(PAPA, [al!.id], { now: day(5) });
    const res = await call('/api/dogs', { user: PAPA, now: day(5) });
    expect(res.status).toBe(200);
    expect(res.body.records).toEqual([
      { dogId: al!.id, visits: 2, lastVisitDate: '2026-10-05' },
      { dogId: niko!.id, visits: 1, lastVisitDate: '2026-10-03' },
    ]);
  });

  it('よそのおうちの犬の記録は返さない', async () => {
    await registerUser(PAPA, [dog('アル')]);
    const other = await registerUser('U009:よそ', [dog('モモ')]);
    await checkin('U009:よそ', [other.dogs[0]!.id], { now: day(3) });
    const res = await call('/api/dogs', { user: PAPA, now: day(3) });
    expect(res.body.records.map((x: { dogId: number }) => x.dogId)).not.toContain(other.dogs[0]!.id);
  });
});
