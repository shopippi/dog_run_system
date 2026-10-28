import { describe, expect, it } from 'vitest';
import { approveMigrationSchema, isWithinMigrationPeriod, migrationInputSchema, planMigration } from '../src';

describe('旧カードの移行(16章)', () => {
  it('移行したポイントで10以上になれば、その時点で無料券を発行する', () => {
    expect(planMigration(3, 7, 10)).toEqual({
      ticketsIssued: 1,
      balanceAfter: 0,
      ledger: [
        { delta: 7, kind: 'migration' },
        { delta: -10, kind: 'ticket_issue' },
      ],
    });
  });

  it('9までなら無料券は出ない。99なら9枚', () => {
    expect(planMigration(0, 9, 10)).toMatchObject({ ticketsIssued: 0, balanceAfter: 9 });
    expect(planMigration(0, 99, 10)).toMatchObject({ ticketsIssued: 9, balanceAfter: 9 });
    expect(planMigration(5, 0, 10)).toEqual({ ticketsIssued: 0, balanceAfter: 5, ledger: [{ delta: 0, kind: 'migration' }] });
  });

  it('移行期間。初日と最終日は中。未設定の側は制限しない', () => {
    const p = { start: '2026-11-01', end: '2026-12-31' };
    expect(isWithinMigrationPeriod(p, '2026-10-31')).toBe(false);
    expect(isWithinMigrationPeriod(p, '2026-11-01')).toBe(true);
    expect(isWithinMigrationPeriod(p, '2026-12-31')).toBe(true);
    expect(isWithinMigrationPeriod(p, '2027-01-01')).toBe(false);
    expect(isWithinMigrationPeriod({ start: null, end: null }, '2030-01-01')).toBe(true);
    expect(isWithinMigrationPeriod({ start: '2026-11-01', end: null }, '2030-01-01')).toBe(true);
    expect(isWithinMigrationPeriod({ start: null, end: '2026-12-31' }, '2020-01-01')).toBe(true);
  });

  it('入力チェック: ポイント数は0〜99の整数、移行元は2種類', () => {
    expect(migrationInputSchema.safeParse({ source: 'line_card', points: 0 }).success).toBe(true);
    expect(migrationInputSchema.safeParse({ source: 'paper_card', points: 99 }).success).toBe(true);
    expect(migrationInputSchema.safeParse({ source: 'paper_card', points: 100 }).success).toBe(false);
    expect(migrationInputSchema.safeParse({ source: 'paper_card', points: -1 }).success).toBe(false);
    expect(migrationInputSchema.safeParse({ source: 'other', points: 1 }).success).toBe(false);
    expect(approveMigrationSchema.safeParse({ points: 5 }).success).toBe(true);
  });
});
