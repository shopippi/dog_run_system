import { describe, expect, it } from 'vitest';
import { isWithinMigrationPeriod, migrationInputSchema, migrationPointsError, planMigration } from '../src';

describe('旧カードの移行(16章)', () => {
  it('移行したポイントは台帳に足すだけ。10以上になっても無料券には替えない', () => {
    expect(planMigration(3, 7)).toEqual({ balanceAfter: 10, ledger: [{ delta: 7, kind: 'migration' }] });
  });

  it('引き継げるポイントの上限(設定 migration_max_points)。上限ちょうどは引き継げる', () => {
    expect(planMigration(0, 30)).toMatchObject({ balanceAfter: 30 });
    expect(planMigration(5, 0)).toEqual({ balanceAfter: 5, ledger: [{ delta: 0, kind: 'migration' }] });
    expect(migrationPointsError(30, 30)).toBeNull();
    expect(migrationPointsError(31, 30)).toBe('引き継げるポイントは最大30ポイントです。');
    expect(migrationPointsError(50, 50)).toBeNull();
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

  it('入力チェック: ポイント数は0以上の整数、移行元は2種類、旧カードの確認の印が2つとも必要', () => {
    const ok = { confirmed_card: true, collected_card: true };
    expect(migrationInputSchema.safeParse({ source: 'line_card', points: 0, ...ok }).success).toBe(true);
    expect(migrationInputSchema.safeParse({ source: 'paper_card', points: 99, ...ok }).success).toBe(true);
    expect(migrationInputSchema.safeParse({ source: 'paper_card', points: 201, ...ok }).success).toBe(false);
    expect(migrationInputSchema.safeParse({ source: 'paper_card', points: -1, ...ok }).success).toBe(false);
    expect(migrationInputSchema.safeParse({ source: 'other', points: 1, ...ok }).success).toBe(false);
    for (const checks of [{}, { confirmed_card: true }, { collected_card: true }, { confirmed_card: false, collected_card: true }]) {
      const r = migrationInputSchema.safeParse({ source: 'line_card', points: 3, ...checks });
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toBe('旧カードの確認に印を付けてください。');
    }
  });
});
