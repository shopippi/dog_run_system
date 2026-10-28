// 旧カードからの移行の計算(要件定義書 16章、A-05)。

/** 一度に引き継げるポイントの上限(旧カードの残高は 0〜99) */
export const MIGRATION_POINTS_LIMIT = 99;

export type MigrationPlan = {
  /** 無料券の発行 */
  ticketsIssued: number;
  balanceAfter: number;
  /** 台帳に書く行。移行の +N と、無料券の発行の -10 */
  ledger: { delta: number; kind: 'migration' | 'ticket_issue' }[];
};

/**
 * 移行したポイントを台帳に足す(16.1)。無料券1枚分以上になっても自動では交換しない(8章)。
 */
export function planMigration(balance: number, points: number, _pointsPerTicket?: number): MigrationPlan {
  return { ticketsIssued: 0, balanceAfter: balance + points, ledger: [{ delta: points, kind: 'migration' }] };
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
