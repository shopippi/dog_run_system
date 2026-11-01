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

/** 旧カードの「使っていない特典(無料券)」として受け付ける枚数の入力チェックの上限。実際の上限は設定 migration_max_tickets(初期値 1) */
export const MIGRATION_TICKETS_LIMIT = 10;
/** 旧カードに残っていたポイントとして入れられる数の上限(上限で切る前の数。入力ミスを防ぐため) */
export const MIGRATION_CARD_POINTS_LIMIT = 999;

/**
 * 旧カードに残っていたポイントが、引き継げる上限(設定 migration_max_points)を超えるとき、引き継ぐ数と切られる数(16.1)。
 * 上限を超えた分は引き継がない(20章の未決事項。初期案)。
 */
export function capMigrationPoints(cardPoints: number, maxPoints: number): { points: number; cut: number } {
  const points = Math.min(cardPoints, maxPoints);
  return { points, cut: Math.max(0, cardPoints - points) };
}

/** 上限で切ったときに画面に出す文 */
export function migrationCapMessage(cardPoints: number, maxPoints: number): string {
  const { cut } = capMigrationPoints(cardPoints, maxPoints);
  return `引き継げるのは最大${maxPoints}ポイントです。${cardPoints}ポイントのうち${maxPoints}ポイントを引き継ぎ、残りの${cut}ポイントは引き継がれません。`;
}

/**
 * カードの番号やメモを、同じカードかどうかを比べる形にそろえる。
 * 全角を半角に、英字を小文字に、空白・ハイフン・長音・「No.」「番」を取り除く。空なら null。
 */
export function normalizeCardRef(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^no\.?(?=\s*\d)|番$/g, '')
    .replace(/[\s\-‐‑–—―ー_.#/]/g, '');
  return t || null;
}

/**
 * 移行期間の終わりまでの日数(今日が最終日なら 0)。終わりが未設定なら null、過ぎていればマイナス。
 * 日付は日本時間の "2026-11-01" の形。
 */
export function migrationDaysLeft(period: { start: string | null; end: string | null }, today: string): number | null {
  const end = period.end?.slice(0, 10);
  if (!end) return null;
  const ms = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((ms(end) - ms(today)) / 86_400_000);
}

/**
 * 移行期間に対する、今日の位置(16.2)。before: 始まる前 / open: 期間中(未設定を含む) / after: 終わったあと
 */
export function migrationPhase(period: { start: string | null; end: string | null }, today: string): 'before' | 'open' | 'after' {
  const start = period.start?.slice(0, 10) || null;
  const end = period.end?.slice(0, 10) || null;
  if (start && today < start) return 'before';
  if (end && today > end) return 'after';
  return 'open';
}
