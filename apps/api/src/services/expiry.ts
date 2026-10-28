import { addDays, isExpiredSinceLastVisit, toJstDate, toJstIso, type ExpiryRule, type Settings } from '@dr/shared';
import type { JobOutcome } from './jobs';

/**
 * 有効期限の処理(B-05。毎晩 3:10)。settings の point_expiry / ticket_expiry に従って失効させる。
 *
 * ポイント
 * - months_from_grant(もらった日から○か月): 台帳の expires_at が過ぎた分を、まだ使われていなければ失効させる。
 *   使った分(無料券の発行・手動で減らした分・前の失効)は、期限の早いポイントから使ったものとして数える。
 *   取り消した来場の行(来場の +1、そのときの無料券の発行、取り消し)は、合わせて 0 なので数えない。
 * - months_from_last_visit(最後の来場から○か月): 最後の来場(来場がなければ登録日)から○か月たったおうちの残高を 0 にする。
 * - 失効は台帳に kind = 'expire' の行(マイナス)を足して表す。残高の列は持たない。
 *
 * 無料券
 * - months_from_grant: tickets.expires_at が過ぎた未使用の券を「期限切れ」にする
 *   (期限の過ぎた券はもともと使えないため、いまの設定が「期限なし」でも、期限のついた券は期限切れにする)。
 * - months_from_last_visit: 最後の来場から○か月たったおうちの未使用の券を「期限切れ」にする。
 *
 * どちらも、期限の日の終わり(23:59:59)までは使え、その翌日の処理で失効する。
 */
export async function expirePointsAndTickets(db: D1Database, now: Date, settings: Pick<Settings, 'point_expiry' | 'ticket_expiry'>): Promise<JobOutcome> {
  const nowIso = toJstIso(now);
  const today = toJstDate(now);
  const statements: D1PreparedStatement[] = [];
  const expiredPoints: { householdId: number; amount: number }[] = [];

  // ---- ポイント ----
  if (settings.point_expiry.mode === 'months_from_grant') {
    const { results } = await db
      .prepare(
        `SELECT l.household_id,
                SUM(CASE WHEN l.delta > 0 AND l.expires_at IS NOT NULL AND l.expires_at < ?1 THEN l.delta ELSE 0 END) AS expired_grants,
                SUM(CASE WHEN l.delta < 0 THEN -l.delta ELSE 0 END) AS used,
                SUM(l.delta) AS balance
           FROM point_ledger l
          WHERE l.household_id IN (
                  SELECT DISTINCT household_id FROM point_ledger WHERE delta > 0 AND expires_at IS NOT NULL AND expires_at < ?1
                )
            AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.id = l.visit_id AND v.cancelled_at IS NOT NULL)
          GROUP BY l.household_id`,
      )
      .bind(nowIso)
      .all<{ household_id: number; expired_grants: number; used: number; balance: number }>();
    for (const r of results) {
      const amount = Math.min(r.balance, Math.max(0, r.expired_grants - r.used));
      if (amount > 0) expiredPoints.push({ householdId: r.household_id, amount });
    }
  } else if (settings.point_expiry.mode === 'months_from_last_visit') {
    for (const h of await dormantHouseholds(db, settings.point_expiry, today)) {
      if (h.balance > 0) expiredPoints.push({ householdId: h.id, amount: h.balance });
    }
  }
  const reason = reasonOf(settings.point_expiry);
  for (const p of expiredPoints) {
    statements.push(
      db
        .prepare(
          `INSERT INTO point_ledger (household_id, delta, kind, reason, actor_type, created_at)
           VALUES (?, ?, 'expire', ?, 'system', ?)`,
        )
        .bind(p.householdId, -p.amount, reason, nowIso),
    );
  }

  // ---- 無料券 ----
  let ticketIds: number[] = [];
  {
    const { results } = await db
      .prepare("SELECT id FROM tickets WHERE status = 'unused' AND expires_at IS NOT NULL AND expires_at < ?")
      .bind(nowIso)
      .all<{ id: number }>();
    ticketIds = results.map((r) => r.id);
  }
  if (settings.ticket_expiry.mode === 'months_from_last_visit') {
    const households = (await dormantHouseholds(db, settings.ticket_expiry, today)).filter((h) => h.unused_tickets > 0);
    if (households.length > 0) {
      const { results } = await db
        .prepare(`SELECT id FROM tickets WHERE status = 'unused' AND household_id IN (SELECT value FROM json_each(?))`)
        .bind(JSON.stringify(households.map((h) => h.id)))
        .all<{ id: number }>();
      ticketIds = [...new Set([...ticketIds, ...results.map((r) => r.id)])];
    }
  }
  if (ticketIds.length > 0) {
    statements.push(
      db
        .prepare(
          `UPDATE tickets SET status = 'expired', note = ?
            WHERE status = 'unused' AND id IN (SELECT value FROM json_each(?))`,
        )
        .bind(reasonOf(settings.ticket_expiry), JSON.stringify(ticketIds)),
    );
  }

  const totalPoints = expiredPoints.reduce((s, p) => s + p.amount, 0);
  if (statements.length > 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO audit_log (actor_type, action, target_type, target_id, after_value, reason, created_at)
           VALUES ('system', 'expiry.run', 'system', 'expiry', ?, ?, ?)`,
        )
        .bind(
          JSON.stringify({ points: expiredPoints.slice(0, 500), tickets: ticketIds.slice(0, 500) }),
          '有効期限の処理(毎晩の自動処理)',
          nowIso,
        ),
    );
    // 台帳の行が多いときも D1 の1回の batch に収まるよう、分けて書く
    for (let i = 0; i < statements.length; i += 200) await db.batch(statements.slice(i, i + 200));
  }
  return {
    message:
      expiredPoints.length === 0 && ticketIds.length === 0
        ? '期限が切れたポイントと無料券はありませんでした。'
        : `${expiredPoints.length}軒のおうちのポイント(合計${totalPoints}ポイント)と、無料券${ticketIds.length}枚を期限切れにしました。`,
  };
}

function reasonOf(rule: ExpiryRule): string {
  if (rule.mode === 'months_from_grant') return `有効期限切れ(もらった日から${rule.months}か月)`;
  if (rule.mode === 'months_from_last_visit') return `有効期限切れ(最後の来場から${rule.months}か月)`;
  return '有効期限切れ';
}

/**
 * 最後の来場(来場がなければ登録日)から○か月たったおうち。ポイントか未使用の無料券が残っているおうちだけ。
 * まず「28日 × 月数」より前のおうちに絞り、月の日数の違いは isExpiredSinceLastVisit で正しく判定する。
 */
async function dormantHouseholds(db: D1Database, rule: Extract<ExpiryRule, { mode: 'months_from_last_visit' }>, today: string) {
  const roughCutoff = addDays(today, -28 * rule.months);
  const { results } = await db
    .prepare(
      `SELECT * FROM (
         SELECT h.id,
                COALESCE((SELECT MAX(v.visit_date) FROM visits v WHERE v.household_id = h.id AND v.cancelled_at IS NULL),
                         substr(h.registered_at, 1, 10)) AS last_date,
                (SELECT COALESCE(SUM(delta), 0) FROM point_ledger WHERE household_id = h.id) AS balance,
                (SELECT COUNT(*) FROM tickets t WHERE t.household_id = h.id AND t.status = 'unused') AS unused_tickets
           FROM households h
          WHERE h.status = 'active'
       ) WHERE last_date < ? AND (balance > 0 OR unused_tickets > 0)`,
    )
    .bind(roughCutoff)
    .all<{ id: number; last_date: string; balance: number; unused_tickets: number }>();
  return results.filter((r) => isExpiredSinceLastVisit(r.last_date, rule.months, today));
}
