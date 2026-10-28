import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, expiryFor, planCheckin, pointsToNextTicket, sumLedger, ticketsFromBalance } from '../src';

const S = DEFAULT_SETTINGS;

describe('チェックインのポイント(8章)', () => {
  it('1ポイント付ける', () => {
    const p = planCheckin({ balance: 3, useTicket: false, settings: S });
    expect(p).toMatchObject({ pointsAwarded: 1, ticketsIssued: 0, balanceAfter: 4 });
    expect(p.ledger).toEqual([{ delta: 1, kind: 'visit' }]);
  });

  it('9ポイントのおうちがチェックインすると、無料券が1枚発行され、残高は0ポイントになる(19.2)', () => {
    const p = planCheckin({ balance: 9, useTicket: false, settings: S });
    expect(p).toMatchObject({ pointsAwarded: 1, ticketsIssued: 1, balanceAfter: 0 });
    expect(p.ledger).toEqual([
      { delta: 1, kind: 'visit' },
      { delta: -10, kind: 'ticket_issue' },
    ]);
  });

  it('8ポイントなら、まだ無料券は出ない', () => {
    expect(planCheckin({ balance: 8, useTicket: false, settings: S })).toMatchObject({ ticketsIssued: 0, balanceAfter: 9 });
  });

  it('無料券を使った日も、初期設定ではポイントを付ける', () => {
    expect(planCheckin({ balance: 9, useTicket: true, settings: S })).toMatchObject({ pointsAwarded: 1, ticketsIssued: 1 });
  });

  it('設定で「無料券を使った日は付けない」にすると、ポイントは付かない', () => {
    const p = planCheckin({ balance: 9, useTicket: true, settings: { ...S, grant_point_on_ticket_day: false } });
    expect(p).toMatchObject({ pointsAwarded: 0, ticketsIssued: 0, balanceAfter: 9, ledger: [] });
  });

  it('無料券に必要なポイント数を変えられる', () => {
    expect(planCheckin({ balance: 4, useTicket: false, settings: { ...S, points_per_ticket: 5 } })).toMatchObject({
      ticketsIssued: 1,
      balanceAfter: 0,
    });
  });
});

describe('残高と無料券', () => {
  it('台帳の合計が残高', () => {
    expect(sumLedger([{ delta: 1 }, { delta: 1 }, { delta: -10 }, { delta: 12 }])).toBe(4);
  });

  it('10以上たまった分だけ無料券にする(統合で12になる場合など)', () => {
    expect(ticketsFromBalance(12, 10)).toEqual({ tickets: 1, balanceAfter: 2 });
    expect(ticketsFromBalance(25, 10)).toEqual({ tickets: 2, balanceAfter: 5 });
    expect(ticketsFromBalance(9, 10)).toEqual({ tickets: 0, balanceAfter: 9 });
  });

  it('次の無料券まで', () => {
    expect(pointsToNextTicket(0, 10)).toBe(10);
    expect(pointsToNextTicket(7, 10)).toBe(3);
  });
});

describe('有効期限', () => {
  it('期限なし', () => {
    expect(expiryFor({ mode: 'none' }, new Date())).toBeNull();
  });

  it('もらった日から○か月(月末はその月の最終日)', () => {
    expect(expiryFor({ mode: 'months_from_grant', months: 6 }, new Date('2026-10-28T01:00:00Z'))).toBe(
      '2027-04-28T23:59:59+09:00',
    );
    expect(expiryFor({ mode: 'months_from_grant', months: 1 }, new Date('2027-01-31T01:00:00Z'))).toBe(
      '2027-02-28T23:59:59+09:00',
    );
  });
});
