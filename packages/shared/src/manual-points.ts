// ポイント・無料券の手動登録(A-03)の計算。残高は台帳から計算したものを受け取る(8章)。

export type ManualAdjustInput = {
  /** いまのポイント残高 */
  balance: number;
  /** いま使える無料券の枚数 */
  usableTickets: number;
  /** 増やす(+)・減らす(-)ポイント */
  points: number;
  /** 増やす(+)・減らす(-)無料券の枚数 */
  tickets: number;
  pointsPerTicket: number;
};

export type ManualAdjustPlan =
  | {
      ok: true;
      balanceBefore: number;
      balanceAfter: number;
      ticketsBefore: number;
      ticketsAfter: number;
    }
  | { ok: false; code: 'negative_points' | 'not_enough_tickets'; message: string };

/**
 * 手動の登録の結果を計算する。
 * - ポイントが無料券1枚分以上になっても、自動では交換しない(8章。無料券を足すときは「無料券」の枚数で増やす)
 * - ポイントがマイナスになる減らし方と、持っている枚数より多く無料券を減らすことはできない
 */
export function planManualAdjust(input: ManualAdjustInput): ManualAdjustPlan {
  const raw = input.balance + input.points;
  if (raw < 0) {
    return {
      ok: false,
      code: 'negative_points',
      message: `ポイントは${input.balance}しかないため、${Math.abs(input.points)}ポイント減らせません。減らす数を${input.balance}以下にしてください。`,
    };
  }
  if (input.tickets < 0 && input.usableTickets < -input.tickets) {
    return {
      ok: false,
      code: 'not_enough_tickets',
      message: `使える無料券は${input.usableTickets}枚しかないため、${-input.tickets}枚減らせません。減らす枚数を${input.usableTickets}枚以下にしてください。`,
    };
  }
  return {
    ok: true,
    balanceBefore: input.balance,
    balanceAfter: raw,
    ticketsBefore: input.usableTickets,
    ticketsAfter: input.usableTickets + input.tickets,
  };
}
