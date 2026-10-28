import type { LedgerKind } from './constants';
import { toJstIso } from './date';
import type { ExpiryRule, Settings } from './settings';

// ポイントと無料券の計算(要件定義書 8章)。残高は台帳から計算し、残高の列は持たない。

export type LedgerEntryPlan = { delta: number; kind: LedgerKind };

export type CheckinPlan = {
  /** 来場で付けるポイント */
  pointsAwarded: number;
  /** 台帳に書く行(来場の +1)。無料券はチェックインでは発行しない(交換は会員証の「無料券と交換する」から) */
  ledger: LedgerEntryPlan[];
  balanceBefore: number;
  balanceAfter: number;
};

/** 台帳の増減を合計して、今のポイント残高を出す。交換で引いた分(ticket_issue のマイナス行)も含めた合計が残高。 */
export function sumLedger(entries: { delta: number }[]): number {
  return entries.reduce((s, e) => s + e.delta, 0);
}

/**
 * チェックインで付けるポイントを決める。
 * - おうちごとに1日1ポイント(何頭で来ても、家族の誰がチェックインしても1ポイント)
 * - 無料券を使った日にポイントを付けるかは設定で決める(初期値は付ける)
 * - ポイントは無料券1枚分を超えてもたまり続ける。無料券には自動で替えない(8章。交換はお客さんが押す)
 */
export function planCheckin(input: {
  balance: number;
  /** その日に無料券を使ったか(使った日はポイントを付けない設定のときだけ見る) */
  usedTicketToday: boolean;
  settings: Pick<Settings, 'daily_point_limit' | 'grant_point_on_ticket_day'>;
}): CheckinPlan {
  const { balance, usedTicketToday, settings } = input;
  const pointsAwarded = usedTicketToday && !settings.grant_point_on_ticket_day ? 0 : Math.min(1, settings.daily_point_limit);
  const ledger: LedgerEntryPlan[] = [];
  if (pointsAwarded > 0) ledger.push({ delta: pointsAwarded, kind: 'visit' });
  return { pointsAwarded, ledger, balanceBefore: balance, balanceAfter: balance + pointsAwarded };
}

/** 無料券と交換できるか(残高が無料券1枚分以上) */
export function canExchange(balance: number, pointsPerTicket: number): boolean {
  return balance >= pointsPerTicket;
}

/** 有効期限。「もらった日から○か月」のときだけ、その日の終わりを期限にする。 */
export function expiryFor(rule: ExpiryRule, now: Date): string | null {
  if (rule.mode !== 'months_from_grant') return null; // 期限なし・最終来場からの期限は、毎晩の処理で判定する
  const iso = toJstIso(now);
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + rule.months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  const td = Math.min(d, lastDay);
  return `${ty}-${String(tm).padStart(2, '0')}-${String(td).padStart(2, '0')}T23:59:59+09:00`;
}

/** 無料券と交換できるまで、あと何ポイントか(交換できるときは 0) */
export function pointsToNextTicket(balance: number, pointsPerTicket: number): number {
  return Math.max(0, pointsPerTicket - balance);
}
