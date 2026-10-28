import { describe, expect, it } from 'vitest';
import { call, checkin, dog, givePoints, registerUser } from './helpers';

const PAPA = 'U001:パパ';
const DAY1 = '2026-10-28T01:00:00Z';

describe('C-05 完了画面', () => {
  it('犬の写真と名前、会員ID、付与したポイント、無料券、チェックインした時刻を返す', async () => {
    const r = await registerUser(PAPA, [dog('アル'), dog('ニコ')]);
    await givePoints(r.memberNo, 9);
    const done = await checkin(PAPA, [r.dogs[1]!.id], { now: DAY1 });
    const res = await call(`/api/checkins/${done.body.visitId}`, { user: PAPA, now: DAY1 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      memberNo: r.memberNo,
      householdName: 'アル・ニコのおうち',
      visitDate: '2026-10-28',
      checkedInAt: '2026-10-28T10:00:00+09:00',
      checkedInBy: 'パパ',
      isToday: true,
      cancelled: false,
      pointsAwarded: 1,
      ticketsIssued: 1,
      usedTicket: false,
      balance: 0,
      unusedTickets: 1,
      pointsPerTicket: 10,
    });
    expect(res.body.dogs.map((d: { name: string }) => d.name)).toEqual(['ニコ']);
  });

  it('無料券を使ったことを返す', async () => {
    const r = await registerUser(PAPA);
    await givePoints(r.memberNo, 10);
    // 10ポイントあっても、無料券はチェックインのときに発行される
    await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    const done = await checkin(PAPA, [r.dogs[0]!.id], { now: '2026-10-29T01:00:00Z', useTicket: true });
    const res = await call(`/api/checkins/${done.body.visitId}`, { user: PAPA, now: '2026-10-29T01:00:00Z' });
    expect(res.body).toMatchObject({ usedTicket: true });
  });

  it('前の日のチェックインは「今日ではない」と返す', async () => {
    const r = await registerUser(PAPA);
    const done = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    const res = await call(`/api/checkins/${done.body.visitId}`, { user: PAPA, now: '2026-10-29T01:00:00Z' });
    expect(res.body.isToday).toBe(false);
  });

  it('よそのおうちのチェックインは見られない', async () => {
    const r = await registerUser(PAPA);
    const done = await checkin(PAPA, [r.dogs[0]!.id], { now: DAY1 });
    await registerUser('U900:よそ', [dog('ハナ')]);
    const res = await call(`/api/checkins/${done.body.visitId}`, { user: 'U900:よそ', now: DAY1 });
    expect(res.status).toBe(404);
  });
});
