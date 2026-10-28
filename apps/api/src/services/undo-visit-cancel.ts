import { toJstIso } from '@dr/shared';
import { errors } from '../lib/errors';
import { refreshDailyStatsQuietly } from './daily-stats';
import { pointBalance } from './points';
import type { AuditRow, UndoContext } from './undo';

/**
 * S-03 の取り消し(visit.cancel)を元に戻す(A-15)。
 * 来場を「取り消し済み」から戻し、取り消しで戻したポイントと無料券を、もう一度当てる。
 * - 同じ日に、そのおうちの別の来場がすでにあれば戻せない(1日1回)
 * - 取り消しで回収した(以前の記録の)無料券は未使用に戻す
 * - 取り消しで未使用に戻した無料券は、同じ券をもう一度「使用済み」にする(その間に使われていれば戻せない)
 * - 戻すとポイントがマイナスになる(その後にポイントが使われた)ときは戻せない
 */
export async function undoVisitCancel(db: D1Database, log: AuditRow, ctx: UndoContext): Promise<void> {
  const undo = parseUndo(log.undo_info);
  const before = parseUndo(log.before_value) as {
    usedTicket?: boolean;
    usedTickets?: { id: number; usedAt: string | null }[];
    issuedTickets?: number[];
  };
  const visitId = Number(undo.visitId ?? log.target_id);
  const visit = await db
    .prepare('SELECT id, household_id, visit_date, used_ticket, cancelled_at FROM visits WHERE id = ?')
    .bind(visitId)
    .first<{ id: number; household_id: number | null; visit_date: string; used_ticket: number; cancelled_at: string | null }>();
  const usedTickets = Array.isArray(before.usedTickets)
    ? before.usedTickets.filter((t) => t && Number.isInteger(t.id))
    : null;
  if (!visit) throw errors.notFound('来場の記録が見つかりませんでした。画面を読み込み直してください。');
  if (!visit.cancelled_at) {
    throw errors.conflict('not_cancelled', 'この来場は、すでに取り消されていない状態です。今日の来場の画面で確かめてください。');
  }
  const nowIso = toJstIso(ctx.now);
  const statements: D1PreparedStatement[] = [];

  if (visit.household_id) {
    const h = await db.prepare('SELECT status FROM households WHERE id = ?').bind(visit.household_id).first<{ status: string }>();
    if (h?.status !== 'active') {
      throw errors.conflict('household_inactive', 'このおうちは統合済みか退会済みのため、戻せません。製作者に相談してください。');
    }
    const other = await db
      .prepare('SELECT id FROM visits WHERE household_id = ? AND visit_date = ? AND cancelled_at IS NULL AND id <> ?')
      .bind(visit.household_id, visit.visit_date, visit.id)
      .first<{ id: number }>();
    if (other) {
      throw errors.conflict(
        'visit_exists',
        'この日には、そのあとに別のチェックインがあるため戻せません。必要なら、ポイントの手動登録で調整してください。',
      );
    }

    // 取り消しで戻したポイント(まだ戻し直していないもの)をもう一度当てる
    const { results: cancels } = await db
      .prepare(
        `SELECT l.id, l.delta FROM point_ledger l
          WHERE l.visit_id = ? AND l.kind = 'cancel' AND l.reverses_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM point_ledger r WHERE r.reverses_id = l.id)`,
      )
      .bind(visit.id)
      .all<{ id: number; delta: number }>();
    const giveBack = cancels.reduce((s, c) => s + c.delta, 0);
    if (giveBack !== 0 && (await pointBalance(db, visit.household_id)) - giveBack < 0) {
      throw errors.conflict(
        'balance_negative',
        '取り消しのあとにポイントが使われたため、戻すとポイントが足りなくなります。ポイントの手動登録で調整してください。',
      );
    }
    for (const c of cancels) {
      statements.push(
        db
          .prepare(
            `INSERT INTO point_ledger (household_id, delta, kind, visit_id, reason, actor_type, actor_id, created_at, reverses_id)
             VALUES (?, ?, 'cancel', ?, '取り消しを元に戻した', 'staff', ?, ?, ?)`,
          )
          .bind(visit.household_id, -c.delta, visit.id, ctx.staffId, nowIso, c.id),
      );
    }

    // 回収した無料券を未使用に戻す
    const issued = (before.issuedTickets ?? []).filter((n) => Number.isInteger(n));
    if (issued.length) {
      statements.push(
        db
          .prepare(
            `UPDATE tickets SET status = 'unused', note = NULL
              WHERE issued_visit_id = ? AND status = 'void' AND id IN (${issued.map(() => '?').join(',')})`,
          )
          .bind(visit.id, ...issued),
      );
    }

    // 取り消しで未使用に戻した無料券を、もう一度使ったことにする
    if (usedTickets && usedTickets.length > 0) {
      const marks = usedTickets.map(() => '?').join(',');
      const still = await db
        .prepare(`SELECT COUNT(*) AS n FROM tickets WHERE status = 'unused' AND household_id = ? AND id IN (${marks})`)
        .bind(visit.household_id, ...usedTickets.map((t) => t.id))
        .first<{ n: number }>();
      if ((still?.n ?? 0) !== usedTickets.length) {
        throw errors.conflict(
          'no_ticket',
          'この来場で使った無料券が、そのあとにまた使われたため戻せません。ポイント・無料券の手動登録で調整してください。',
        );
      }
      for (const t of usedTickets) {
        statements.push(
          db
            .prepare(`UPDATE tickets SET status = 'used', used_visit_id = ?, used_at = ? WHERE id = ? AND status = 'unused'`)
            .bind(visit.id, t.usedAt ?? nowIso, t.id),
        );
      }
    } else if (!usedTickets && visit.used_ticket === 1) {
      // 以前の記録(チェックインのときに無料券を使っていたころ)。使える券をもう一度「使用済み」にする(この来場で発行された券は使わない)
      const t = await db
        .prepare(
          `SELECT id FROM tickets
            WHERE household_id = ? AND status = 'unused' AND (expires_at IS NULL OR expires_at >= ?)
              AND (issued_visit_id IS NULL OR issued_visit_id <> ?)
            ORDER BY expires_at IS NULL, expires_at, id LIMIT 1`,
        )
        .bind(visit.household_id, nowIso, visit.id)
        .first<{ id: number }>();
      if (!t) {
        throw errors.conflict(
          'no_ticket',
          'この来場で使った無料券が、もう残っていないため戻せません。ポイントの手動登録で調整してください。',
        );
      }
      statements.push(
        db
          .prepare(`UPDATE tickets SET status = 'used', used_visit_id = ?, used_at = ? WHERE id = ? AND status = 'unused'`)
          .bind(visit.id, nowIso, t.id),
      );
    }
  }

  statements.push(
    db
      .prepare(
        `UPDATE visits SET cancelled_at = NULL, cancel_reason = NULL, cancelled_by_staff_id = NULL
          WHERE id = ? AND cancelled_at IS NOT NULL`,
      )
      .bind(visit.id),
  );
  try {
    await db.batch(statements);
  } catch (e) {
    if (/UNIQUE constraint failed: visits/.test(String((e as Error)?.message))) {
      throw errors.conflict(
        'visit_exists',
        'この日には、そのあとに別のチェックインがあるため戻せません。必要なら、ポイントの手動登録で調整してください。',
      );
    }
    throw e;
  }
  await refreshDailyStatsQuietly(db, visit.visit_date, ctx.now);
}

function parseUndo(text: string | null): Record<string, any> {
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
