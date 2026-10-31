import {
  expiryFor,
  manualReasonText,
  planManualAdjust,
  toJstIso,
  type ManualPointsInput,
  type ManualPointsPreview,
  type Settings,
} from '@dr/shared';
import { errors } from '../lib/errors';
import { auditStatement } from './audit';
import { pointBalance, unusedTicketCount } from './points';
import type { AuditRow, UndoContext } from './undo';

const USABLE = "status = 'unused' AND (expires_at IS NULL OR expires_at >= ?)";

/** 手動の登録の結果を計算する(A-03)。できないときは 409 で理由を返す */
export async function previewManualPoints(
  db: D1Database,
  householdId: number,
  input: Pick<ManualPointsInput, 'points' | 'tickets'>,
  settings: Settings,
  now: Date,
): Promise<ManualPointsPreview> {
  const plan = planManualAdjust({
    balance: await pointBalance(db, householdId),
    usableTickets: await unusedTicketCount(db, householdId, now),
    points: input.points,
    tickets: input.tickets,
    pointsPerTicket: settings.points_per_ticket,
  });
  if (!plan.ok) throw errors.conflict(plan.code, plan.message);
  const { ok: _ok, ...rest } = plan;
  return { ...rest, pointsPerTicket: settings.points_per_ticket };
}

/**
 * ポイント・無料券の手動登録(A-03、8章)。
 * - ポイントは台帳に「手動」で記録する。無料券1枚分以上になっても、自動では交換しない(8章)
 * - 無料券を増やすときは「手動で追加」の券を作り、減らすときは使える券を「取り消し」にする
 * - 書いた台帳の行と券には同じ印(op_id)を付け、操作ログから元に戻せるようにする
 */
export async function applyManualPoints(
  db: D1Database,
  args: { householdId: number; input: ManualPointsInput; staffId: number; settings: Settings; now: Date },
): Promise<ManualPointsPreview> {
  const { householdId, input, settings, now } = args;
  const preview = await previewManualPoints(db, householdId, input, settings, now);
  const nowIso = toJstIso(now);
  const opId = crypto.randomUUID();
  const reason = manualReasonText(input);
  const statements: D1PreparedStatement[] = [];

  if (input.points !== 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO point_ledger (household_id, delta, kind, reason, actor_type, actor_id, created_at, expires_at, op_id)
           VALUES (?, ?, 'manual', ?, 'staff', ?, ?, ?, ?)`,
        )
        .bind(householdId, input.points, reason, args.staffId, nowIso, input.points > 0 ? expiryFor(settings.point_expiry, now) : null, opId),
    );
  }
  for (let i = 0; i < input.tickets; i++) {
    statements.push(
      db
        .prepare(
          `INSERT INTO tickets (household_id, issued_at, expires_at, source, status, note, op_id)
           VALUES (?, ?, ?, 'manual', 'unused', ?, ?)`,
        )
        .bind(householdId, nowIso, expiryFor(settings.ticket_expiry, now), reason, opId),
    );
  }
  let voided: number[] = [];
  if (input.tickets < 0) {
    // 減らすときは、新しく発行された券から取り消す
    const { results } = await db
      .prepare(`SELECT id FROM tickets WHERE household_id = ? AND ${USABLE} ORDER BY issued_at DESC, id DESC LIMIT ?`)
      .bind(householdId, nowIso, -input.tickets)
      .all<{ id: number }>();
    voided = results.map((r) => r.id);
    statements.push(
      db
        .prepare(`UPDATE tickets SET status = 'void', note = ? WHERE status = 'unused' AND id IN (SELECT value FROM json_each(?))`)
        .bind(`手動で減らした: ${reason}`, JSON.stringify(voided)),
    );
  }
  statements.push(
    auditStatement(db, {
      staffId: args.staffId,
      action: 'points.manual',
      targetType: 'household',
      targetId: householdId,
      before: { balance: preview.balanceBefore, tickets: preview.ticketsBefore },
      after: {
        balance: preview.balanceAfter,
        tickets: preview.ticketsAfter,
        points: input.points,
        ticketDelta: input.tickets,
      },
      reason,
      undo: { householdId, opId, voidedTicketIds: voided },
      now,
    }),
  );
  await db.batch(statements);
  return preview;
}

/** 手動の登録を元に戻す。増えた無料券が使われていたり、戻すとポイントがマイナスになるときは戻せない */
export async function undoManualPoints(db: D1Database, log: AuditRow, ctx: UndoContext): Promise<void> {
  const undo = JSON.parse(log.undo_info ?? '{}') as { householdId: number; opId: string; voidedTicketIds?: number[] };
  const householdId = undo.householdId;
  const h = await db.prepare('SELECT status FROM households WHERE id = ?').bind(householdId).first<{ status: string }>();
  if (h?.status !== 'active') {
    throw errors.conflict('household_inactive', 'このおうちは統合済みか退会済みのため、戻せません。製作者に相談してください。');
  }
  const nowIso = toJstIso(ctx.now);
  const { results: ledger } = await db
    .prepare('SELECT id, delta, kind FROM point_ledger WHERE op_id = ? AND household_id = ?')
    .bind(undo.opId, householdId)
    .all<{ id: number; delta: number; kind: string }>();
  const { results: added } = await db
    .prepare('SELECT id, status FROM tickets WHERE op_id = ? AND household_id = ?')
    .bind(undo.opId, householdId)
    .all<{ id: number; status: string }>();
  if (added.some((t) => t.status === 'used')) {
    throw errors.conflict(
      'ticket_already_used',
      'この操作で増えた無料券が、もう使われているため戻せません。必要なら、もう一度ポイントの手動登録で調整してください。',
    );
  }
  const voided = (undo.voidedTicketIds ?? []).filter((n) => Number.isInteger(n));
  const balance = await pointBalance(db, householdId);
  const change = -ledger.reduce((s, l) => s + l.delta, 0);
  const next = balance + change;
  if (next < 0) {
    throw errors.conflict(
      'balance_negative',
      'この操作のあとにポイントが使われたため、戻すとポイントが足りなくなります。もう一度ポイントの手動登録で調整してください。',
    );
  }

  const statements: D1PreparedStatement[] = ledger.map((l) =>
    db
      .prepare(
        `INSERT INTO point_ledger (household_id, delta, kind, reason, actor_type, actor_id, created_at, reverses_id)
         VALUES (?, ?, ?, '操作ログから元に戻した', 'staff', ?, ?, ?)`,
      )
      .bind(householdId, -l.delta, l.kind, ctx.staffId, nowIso, l.id),
  );
  if (added.length) {
    statements.push(
      db
        .prepare(`UPDATE tickets SET status = 'void', note = '手動の登録を元に戻した' WHERE op_id = ? AND status IN ('unused', 'expired')`)
        .bind(undo.opId),
    );
  }
  if (voided.length) {
    statements.push(
      db
        .prepare(`UPDATE tickets SET status = 'unused', note = NULL WHERE status = 'void' AND id IN (SELECT value FROM json_each(?))`)
        .bind(JSON.stringify(voided)),
    );
  }
  if (statements.length) await db.batch(statements);
}
