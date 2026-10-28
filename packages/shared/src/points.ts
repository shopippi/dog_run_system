import type { LedgerKind } from './constants';
import { toJstIso } from './date';
import type { ExpiryRule, Settings } from './settings';

// ポイントと無料券の計算(要件定義書 8章)。残高は台帳から計算し、残高の列は持たない。

export type LedgerEntryPlan = { delta: number; kind: LedgerKind };

export type CheckinPlan = {
  /** 来場で付けるポイント */
  pointsAwarded: number;
  /** ポイントがたまって発行する無料券の枚数 */
  ticketsIssued: number;
  /** 台帳に書く行(来場の +1、無料券の発行の -10 など) */
  ledger: LedgerEntryPlan[];
  balanceBefore: number;
  balanceAfter: number;
};

/** 台帳の増減を合計して、今のポイント残高を出す。 */
export function sumLedger(entries: { delta: number }[]): number {
  return entries.reduce((s, e) => s + e.delta, 0);
}

/**
 * ポイントが無料券1枚分以上たまっていたら、その分の無料券を発行する。
 * 移行・統合・手動の登録でも使う(16.1、5.3)。
 */
export function ticketsFromBalance(balance: number, pointsPerTicket: number): { tickets: number; balanceAfter: number } {
  if (balance < pointsPerTicket) return { tickets: 0, balanceAfter: balance };
  const tickets = Math.floor(balance / pointsPerTicket);
  return { tickets, balanceAfter: balance - tickets * pointsPerTicket };
}

/**
 * チェックインで付けるポイントと、発行する無料券を決める。
 * - おうちごとに1日1ポイント(何頭で来ても、家族の誰がチェックインしても1ポイント)
 * - 無料券を使った日にポイントを付けるかは設定で決める(初期値は付ける)
 * - ポイントが10になった時点で無料券を1枚発行し、10ポイントを差し引く
 */
export function planCheckin(input: {
  balance: number;
  useTicket: boolean;
  settings: Pick<Settings, 'points_per_ticket' | 'daily_point_limit' | 'grant_point_on_ticket_day'>;
}): CheckinPlan {
  const { balance, useTicket, settings } = input;
  const pointsAwarded = useTicket && !settings.grant_point_on_ticket_day ? 0 : Math.min(1, settings.daily_point_limit);
  const ledger: LedgerEntryPlan[] = [];
  if (pointsAwarded > 0) ledger.push({ delta: pointsAwarded, kind: 'visit' });
  const { tickets, balanceAfter } = ticketsFromBalance(balance + pointsAwarded, settings.points_per_ticket);
  for (let i = 0; i < tickets; i++) ledger.push({ delta: -settings.points_per_ticket, kind: 'ticket_issue' });
  return { pointsAwarded, ticketsIssued: tickets, ledger, balanceBefore: balance, balanceAfter };
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

/** 次の無料券まであと何ポイントか */
export function pointsToNextTicket(balance: number, pointsPerTicket: number): number {
  const r = balance % pointsPerTicket;
  return pointsPerTicket - r;
}
