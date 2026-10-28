import { describe, expect, it } from 'vitest';
import { addFamily, call, checkin, dog, exchangeTicket, givePoints, registerUser, useTicketOf } from './helpers';

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
      todayUsedTicketId: null,
    });
    expect(res.body.card.dogs.map((d: { name: string }) => d.name)).toEqual(['アル', 'ニコ']);
  });

  it('10ポイントになっても無料券は出ず「交換できる」状態になる。交換すると会員証に無料券が表示され、今日のチェックインと使った券がわかる', async () => {
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 9);
    const done = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    let res = await call('/api/me', { user: PAPA, now: DAY1 });
    expect(res.body.card).toMatchObject({ balance: 10, toNextTicket: 0, tickets: [], todayVisitId: done.body.visitId });
    await exchangeTicket(PAPA, { now: DAY1 });
    res = await call('/api/me', { user: PAPA, now: DAY1 });
    expect(res.body.card).toMatchObject({ balance: 0, toNextTicket: 10, todayUsedTicketId: null });
    expect(res.body.card.tickets).toHaveLength(1);
    const used = await useTicketOf(PAPA, { now: DAY1 });
    res = await call('/api/me', { user: PAPA, now: DAY1 });
    expect(res.body.card).toMatchObject({ tickets: [], todayUsedTicketId: used.body.ticketId });
    // 次の日は「今日使った券」ではない
    expect((await call('/api/me', { user: PAPA, now: '2026-10-29T01:00:00Z' })).body.card.todayUsedTicketId).toBeNull();
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
