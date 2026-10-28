import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, canExchange, expiryFor, planCheckin, pointsToNextTicket, sumLedger } from '../src';

const S = DEFAULT_SETTINGS;

describe('チェックインのポイント(8章)', () => {
  it('1ポイント付ける', () => {
    const p = planCheckin({ balance: 3, usedTicketToday: false, settings: S });
    expect(p).toMatchObject({ pointsAwarded: 1, balanceAfter: 4 });
    expect(p.ledger).toEqual([{ delta: 1, kind: 'visit' }]);
  });

  it('9ポイントのおうちがチェックインすると10ポイントになる。無料券は自動では発行しない', () => {
    const p = planCheckin({ balance: 9, usedTicketToday: false, settings: S });
    expect(p).toMatchObject({ pointsAwarded: 1, balanceAfter: 10 });
    expect(p.ledger).toEqual([{ delta: 1, kind: 'visit' }]);
  });

  it('10ポイントを超えても、ポイントはたまり続ける', () => {
    expect(planCheckin({ balance: 10, usedTicketToday: false, settings: S })).toMatchObject({ balanceAfter: 11 });
    expect(planCheckin({ balance: 25, usedTicketToday: false, settings: S })).toMatchObject({ balanceAfter: 26 });
  });

  it('無料券を使った日も、初期設定ではポイントを付ける', () => {
    expect(planCheckin({ balance: 9, usedTicketToday: true, settings: S })).toMatchObject({ pointsAwarded: 1, balanceAfter: 10 });
  });

  it('設定で「無料券を使った日は付けない」にすると、ポイントは付かない', () => {
    const p = planCheckin({ balance: 9, usedTicketToday: true, settings: { ...S, grant_point_on_ticket_day: false } });
    expect(p).toMatchObject({ pointsAwarded: 0, balanceAfter: 9, ledger: [] });
  });

  it('交換できるのは、無料券に必要なポイント数以上のとき(設定で変えられる)', () => {
    expect(canExchange(9, 10)).toBe(false);
    expect(canExchange(10, 10)).toBe(true);
    expect(canExchange(15, 10)).toBe(true);
    expect(canExchange(4, 5)).toBe(false);
    expect(canExchange(5, 5)).toBe(true);
  });
});

describe('残高と無料券', () => {
  it('台帳の合計が残高', () => {
    expect(sumLedger([{ delta: 1 }, { delta: 1 }, { delta: -10 }, { delta: 12 }])).toBe(4);
  });

  it('残高は、ためたポイントの合計から、交換で引いた分を除いたもの', () => {
    // 12ポイントためて1回交換すると、2ポイント残る
    const ledger = [...Array.from({ length: 12 }, () => ({ delta: 1 })), { delta: -10 }];
    expect(sumLedger(ledger)).toBe(2);
    expect(sumLedger([...ledger, { delta: 5 }, { delta: 5 }, { delta: -10 }])).toBe(2);
  });

  it('交換できるまで、あと何ポイントか(交換できるときは0)', () => {
    expect(pointsToNextTicket(0, 10)).toBe(10);
    expect(pointsToNextTicket(7, 10)).toBe(3);
    expect(pointsToNextTicket(9, 10)).toBe(1);
    expect(pointsToNextTicket(10, 10)).toBe(0);
    expect(pointsToNextTicket(15, 10)).toBe(0);
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
