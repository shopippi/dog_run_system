import { describe, expect, it } from 'vitest';
import { manualPointsSchema, manualReasonText, planManualAdjust } from '../src';

const plan = (balance: number, usableTickets: number, points: number, tickets: number) =>
  planManualAdjust({ balance, usableTickets, points, tickets, pointsPerTicket: 10 });

describe('A-03 手動の登録の計算', () => {
  it('ポイントを増やすだけ(10 未満)', () => {
    expect(plan(3, 0, 1, 0)).toEqual({ ok: true, balanceBefore: 3, balanceAfter: 4, ticketsBefore: 0, ticketsAfter: 0, ticketsIssued: 0 });
  });
  it('9 → 10 になると無料券を1枚発行し、0 ポイントになる', () => {
    expect(plan(9, 0, 1, 0)).toMatchObject({ ok: true, balanceAfter: 0, ticketsAfter: 1, ticketsIssued: 1 });
  });
  it('一度に 25 ポイント増やすと 2 枚発行して 5 ポイント残る', () => {
    expect(plan(0, 1, 25, 0)).toMatchObject({ ok: true, balanceAfter: 5, ticketsAfter: 3, ticketsIssued: 2 });
  });
  it('残高ちょうどまで減らせる。マイナスになる減らし方はできない', () => {
    expect(plan(3, 0, -3, 0)).toMatchObject({ ok: true, balanceAfter: 0 });
    expect(plan(3, 0, -4, 0)).toMatchObject({ ok: false, code: 'negative_points' });
  });
  it('無料券を増やす・減らす。持っている枚数より多くは減らせない', () => {
    expect(plan(0, 0, 0, 2)).toMatchObject({ ok: true, ticketsAfter: 2 });
    expect(plan(0, 2, 0, -2)).toMatchObject({ ok: true, ticketsAfter: 0 });
    expect(plan(0, 2, 0, -3)).toMatchObject({ ok: false, code: 'not_enough_tickets' });
  });
});

describe('A-03 手動の登録の入力', () => {
  it('理由は選択式。「その他」は内容が必要', () => {
    expect(manualPointsSchema.safeParse({ points: 1, tickets: 0, reason: 'お詫び' }).success).toBe(true);
    expect(manualPointsSchema.safeParse({ points: 1, tickets: 0, reason: 'なんとなく' }).success).toBe(false);
    const other = manualPointsSchema.safeParse({ points: 1, tickets: 0, reason: 'その他', note: ' ' });
    expect(other.success).toBe(false);
    expect(other.error?.issues[0]?.message).toBe('「その他」を選んだときは、理由の内容を入力してください。');
  });
  it('増やす・減らすものがないとき、範囲を超えるときは受け付けない', () => {
    expect(manualPointsSchema.safeParse({ points: 0, tickets: 0, reason: 'お詫び' }).success).toBe(false);
    expect(manualPointsSchema.safeParse({ points: 101, tickets: 0, reason: 'お詫び' }).success).toBe(false);
    expect(manualPointsSchema.safeParse({ points: 100, tickets: -20, reason: 'お詫び' }).success).toBe(true);
  });
  it('理由の文', () => {
    expect(manualReasonText({ reason: 'お詫び', note: '' })).toBe('お詫び');
    expect(manualReasonText({ reason: 'お詫び', note: '待たせた' })).toBe('お詫び(待たせた)');
    expect(manualReasonText({ reason: 'その他', note: '紙のカードの分' })).toBe('その他: 紙のカードの分');
  });
});
