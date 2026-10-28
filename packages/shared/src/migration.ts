// 旧カードからの移行の計算(要件定義書 16章、A-05)。

/** 入力チェックで受け付けるポイント数の上限。実際に引き継げる上限は設定 migration_max_points(初期値 30)で決める */
export const MIGRATION_POINTS_LIMIT = 200;

export type MigrationPlan = {
  balanceAfter: number;
  /** 台帳に書く行(移行の +N だけ。無料券には自動で替えない。8章) */
  ledger: { delta: number; kind: 'migration' }[];
};

/**
 * 移行したポイントを台帳に足す(16.1)。無料券1枚分以上になっても自動では交換しない(8章)。
 */
export function planMigration(balance: number, points: number): MigrationPlan {
  return { balanceAfter: balance + points, ledger: [{ delta: points, kind: 'migration' }] };
}

/** 引き継ぐポイント数が上限(設定 migration_max_points)を超えていないか。超えていれば画面に出す文を返す */
export function migrationPointsError(points: number, maxPoints: number): string | null {
  return points > maxPoints ? `引き継げるポイントは最大${maxPoints}ポイントです。` : null;
}

/**
 * 移行期間の中か(16.2)。日付は日本時間の "2026-11-01" の形。
 * 始まり・終わりが未設定のときは、その側に制限をかけない(両方未設定なら、いつでも受け付ける)。
 */
export function isWithinMigrationPeriod(period: { start: string | null; end: string | null }, date: string): boolean {
  const start = period.start?.slice(0, 10) || null;
  const end = period.end?.slice(0, 10) || null;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}
