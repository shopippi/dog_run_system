import { toJstIso } from '@dr/shared';

/** ポイント残高。台帳(point_ledger)の合計から計算する。 */
export async function pointBalance(db: D1Database, householdId: number): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(SUM(delta), 0) AS balance FROM point_ledger WHERE household_id = ?')
    .bind(householdId)
    .first<{ balance: number }>();
  return row?.balance ?? 0;
}

const USABLE = "status = 'unused' AND (expires_at IS NULL OR expires_at >= ?)";

/** 使える無料券の枚数。tickets から数える。 */
export async function unusedTicketCount(db: D1Database, householdId: number, now: Date): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM tickets WHERE household_id = ? AND ${USABLE}`)
    .bind(householdId, toJstIso(now))
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** 次に使う無料券(期限の近いものから) */
export async function nextUsableTicket(db: D1Database, householdId: number, now: Date): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT id FROM tickets WHERE household_id = ? AND ${USABLE}
        ORDER BY expires_at IS NULL, expires_at, id LIMIT 1`,
    )
    .bind(householdId, toJstIso(now))
    .first<{ id: number }>();
  return row?.id ?? null;
}
