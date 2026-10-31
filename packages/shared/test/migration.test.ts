import { describe, expect, it } from 'vitest';
import {
  capMigrationPoints,
  isWithinMigrationPeriod,
  migrationCapMessage,
  migrationDaysLeft,
  migrationInputSchema,
  migrationPhase,
  migrationPointsError,
  normalizeCardRef,
  planMigration,
} from '../src';

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
    const ok = { confirmed_card: true, collected_card: true, member_id: 1 };
    expect(migrationInputSchema.safeParse({ source: 'line_card', points: 0, ...ok }).success).toBe(true);
    expect(migrationInputSchema.safeParse({ source: 'paper_card', points: 99, ...ok }).success).toBe(true);
    expect(migrationInputSchema.safeParse({ source: 'paper_card', points: 201, ...ok }).success).toBe(false);
    expect(migrationInputSchema.safeParse({ source: 'paper_card', points: -1, ...ok }).success).toBe(false);
    expect(migrationInputSchema.safeParse({ source: 'other', points: 1, ...ok }).success).toBe(false);
    for (const checks of [{}, { confirmed_card: true }, { collected_card: true }, { confirmed_card: false, collected_card: true }]) {
      const r = migrationInputSchema.safeParse({ source: 'line_card', member_id: 1, points: 3, ...checks });
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toBe('旧カードの確認に印を付けてください。');
    }
  });
});

describe('旧カードの移行: 上限で切る・カードの番号・移行期間の位置', () => {
  it('上限を超えるときは上限までを引き継ぎ、切られる数を出す', () => {
    expect(capMigrationPoints(35, 30)).toEqual({ points: 30, cut: 5 });
    expect(capMigrationPoints(30, 30)).toEqual({ points: 30, cut: 0 });
    expect(capMigrationPoints(7, 30)).toEqual({ points: 7, cut: 0 });
    expect(migrationCapMessage(35, 30)).toBe('引き継げるのは最大30ポイントです。35ポイントのうち30ポイントを引き継ぎ、残りの5ポイントは引き継がれません。');
  });

  it('カードの番号は、全角・大文字・空白・ハイフン・「No.」「番」をそろえて比べる', () => {
    expect(normalizeCardRef('No.０１２３')).toBe('0123');
    expect(normalizeCardRef(' 01-23 ')).toBe('0123');
    expect(normalizeCardRef('0123番')).toBe('0123');
    expect(normalizeCardRef('Ａ－１２')).toBe('a12');
    expect(normalizeCardRef('nori')).toBe('nori');
    expect(normalizeCardRef('')).toBeNull();
    expect(normalizeCardRef(' - ')).toBeNull();
    expect(normalizeCardRef(undefined)).toBeNull();
  });

  it('移行期間の終わりまでの日数と、今日の位置', () => {
    const p = { start: '2026-11-01', end: '2026-12-31' };
    expect(migrationDaysLeft(p, '2026-12-31')).toBe(0);
    expect(migrationDaysLeft(p, '2026-12-01')).toBe(30);
    expect(migrationDaysLeft(p, '2027-01-02')).toBe(-2);
    expect(migrationDaysLeft({ start: null, end: null }, '2026-12-01')).toBeNull();
    expect(migrationPhase(p, '2026-10-31')).toBe('before');
    expect(migrationPhase(p, '2026-11-01')).toBe('open');
    expect(migrationPhase(p, '2027-01-01')).toBe('after');
    expect(migrationPhase({ start: null, end: null }, '2030-01-01')).toBe('open');
  });

  it('入力チェック: 旧カードのポイント数・特典の枚数・カードの番号・メモは任意', () => {
    const ok = { source: 'paper_card', member_id: 1, points: 30, confirmed_card: true, collected_card: true };
    expect(migrationInputSchema.parse(ok).tickets).toBe(0);
    expect(migrationInputSchema.safeParse({ ...ok, card_points: 35, tickets: 1, card_ref: 'No.12', note: 'メモ' }).success).toBe(true);
    expect(migrationInputSchema.safeParse({ ...ok, card_points: 1000 }).success).toBe(false);
    expect(migrationInputSchema.safeParse({ ...ok, tickets: 11 }).success).toBe(false);
    expect(migrationInputSchema.safeParse({ ...ok, card_ref: 'x'.repeat(41) }).success).toBe(false);
    // だれのカードか(家族)は必須(2026-10-30。カード1枚ごとに1回)
    const { member_id: _omit, ...noMember } = ok;
    expect(migrationInputSchema.safeParse(noMember).error?.issues[0]?.message).toBe('だれのカードかを選んでください。');
  });
});
