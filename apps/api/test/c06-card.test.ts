import { describe, expect, it } from 'vitest';
import { addFamily, call, checkin, dog, givePoints, registerUser } from './helpers';

const PAPA = 'U001:パパ';
const DAY1 = '2026-10-28T01:00:00Z';

describe('C-06 会員証', () => {
  it('おうちの呼び名・会員ID・犬・ポイント・次の無料券まで・無料券を返す', async () => {
    const r = await registerUser(PAPA, [dog('アル'), dog('ニコ')]);
    await givePoints(r.memberNo, 6);
    const res = await call('/api/me', { user: PAPA, now: DAY1 });
    expect(res.body.household).toEqual({ memberNo: r.memberNo, displayName: 'アル・ニコのおうち' });
    expect(res.body.card).toMatchObject({
      balance: 6,
      pointsPerTicket: 10,
      toNextTicket: 4,
      tickets: [],
      todayVisitId: null,
    });
    expect(res.body.card.dogs.map((d: { name: string }) => d.name)).toEqual(['アル', 'ニコ']);
  });

  it('チェックインで無料券が出ると、会員証に無料券が表示され、今日のチェックインがわかる', async () => {
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 9);
    const done = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    const res = await call('/api/me', { user: PAPA, now: DAY1 });
    expect(res.body.card).toMatchObject({ balance: 0, toNextTicket: 10, todayVisitId: done.body.visitId });
    expect(res.body.card.tickets).toHaveLength(1);
  });

  it('家族の会員証にも、同じ会員ID・ポイント・犬が表示される', async () => {
    const r = await registerUser(PAPA, [dog('アル')]);
    await addFamily(r.memberNo, 'U002', 'ママ');
    await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    const papa = await call('/api/me', { user: PAPA, now: DAY1 });
    const mama = await call('/api/me', { user: 'U002:ママ', now: DAY1 });
    expect(mama.body.household).toEqual(papa.body.household);
    expect(mama.body.card).toEqual(papa.body.card);
  });

  it('登録解除した犬は会員証に出さない', async () => {
    const r = await registerUser(PAPA, [dog('アル'), dog('ニコ')]);
    await call(`/api/dogs/${r.dogs[1]!.id}/retire`, { user: PAPA, method: 'POST' });
    const res = await call('/api/me', { user: PAPA });
    expect(res.body.card.dogs.map((d: { name: string }) => d.name)).toEqual(['アル']);
  });
});
