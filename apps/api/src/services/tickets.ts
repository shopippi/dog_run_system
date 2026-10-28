import {
  expiryFor,
  toJstDate,
  toJstIso,
  type AdminTicketUseResult,
  type Settings,
  type TicketEvent,
  type TicketExchangeResult,
  type TicketUseDetail,
} from '@dr/shared';
import { errors } from '../lib/errors';
import { auditStatement } from './audit';
import { refreshDailyStatsQuietly } from './daily-stats';
import { MERGED_HOUSEHOLDS_CTE } from './merged-households';
import { pointBalance, unusedTicketCount } from './points';
import type { AuditRow, UndoContext } from './undo';

/*
 * 無料券の「交換する」「使用する」(要件定義書 8章、C-06)。
 * - 無料券は自動では発行しない。お客さんが会員証で「無料券と交換する」を押すと、ポイントを引いて1枚発行する
 * - 台帳(point_ledger)には「無料券と交換」(kind = ticket_issue)のマイナスの行を書く。残高は台帳の合計
 * - 使うときは会員証の「使用する」を受付で見せながら押す。その日の来場があれば、その来場に結びつける
 *   (来場がまだなら、チェックインしたときに結びつける)
 */

/**
 * 来場(別名 v)に、おうちの無料券の使用があるか(SQL の式)。
 * その来場に結びついた券か、その日・そのおうちで使った券(来場に結びついていなくても)を見る(S-02)。
 * 取り消した来場は、結びついた券だけを見る(取り消しで券は未使用に戻るので、ふつうは偽になる)
 */
export const ticketUsedOnVisitSql = (v = 'v') =>
  `EXISTS (SELECT 1 FROM tickets ut WHERE ut.status = 'used' AND ut.household_id = ${v}.household_id
     AND (ut.used_visit_id = ${v}.id OR (${v}.cancelled_at IS NULL AND substr(ut.used_at, 1, 10) = ${v}.visit_date)))`;

/** その日(日本時間)に、おうちで使った無料券(新しい順) */
export async function ticketsUsedOn(db: D1Database, householdId: number, date: string): Promise<{ id: number; used_at: string }[]> {
  const { results } = await db
    .prepare(
      `SELECT id, used_at FROM tickets
        WHERE household_id = ? AND status = 'used' AND used_at >= ? AND used_at < ?
        ORDER BY used_at DESC, id DESC`,
    )
    .bind(householdId, `${date}T00:00:00`, `${date}T99`)
    .all<{ id: number; used_at: string }>();
  return results;
}

/** その日の来場(取り消していないもの)の id を返す SQL。?1 = おうち、?2 = 日付 */
const VISIT_OF_DAY = `(SELECT id FROM visits WHERE household_id = ?1 AND visit_date = ?2 AND cancelled_at IS NULL)`;

/**
 * チェックインで作った来場に、その日にもう使ってあった無料券を結びつける(D1 の batch に入れる)。
 * ?1 = おうち、?2 = 来場日
 */
export function linkUsedTicketsStatement(db: D1Database, householdId: number, visitDate: string): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE tickets SET used_visit_id = ${VISIT_OF_DAY}
        WHERE household_id = ?1 AND status = 'used' AND used_visit_id IS NULL
          AND used_at >= ?2 || 'T00:00:00' AND used_at < ?2 || 'T99'`,
    )
    .bind(householdId, visitDate);
}

const notEnoughPoints = (balance: number, need: number) =>
  errors.conflict(
    'not_enough_points',
    `ポイントが足りないため、無料券と交換できません(いま${Math.max(0, balance)}ポイント)。あと${Math.max(0, need - balance)}ポイントたまると交換できます。`,
    { balance, pointsPerTicket: need },
  );

/**
 * 無料券と交換する(POST /api/tickets/exchange)。
 * 券の発行と台帳の −N の行を、1つのまとまり(D1 の batch)で書く。
 * - 残高の確認は、書き込みの中(INSERT ... WHERE 残高 >= N)で行う。同時に押されても残高を超えて交換しない
 * - 同じ印(opId)の交換が二重に届いたときは、1回目の結果を返す(券の印に一意の索引がある)
 */
export async function exchangeTicket(
  db: D1Database,
  args: { householdId: number; memberId: number; opId?: string; settings: Settings; now: Date },
): Promise<TicketExchangeResult> {
  const { householdId, settings, now } = args;
  const need = settings.points_per_ticket;
  const nowIso = toJstIso(now);
  const op = `exchange:${args.opId ?? crypto.randomUUID()}`;

  const existing = await findExchange(db, householdId, op);
  if (existing) return exchangeResult(db, householdId, existing, need, now);

  const balanceSql = '(SELECT COALESCE(SUM(delta), 0) FROM point_ledger WHERE household_id = ?1)';
  const ticketOfOp = '(SELECT id FROM tickets WHERE op_id = ?4)';
  let results: D1Result[];
  try {
    results = await db.batch([
      db
        .prepare(
          `INSERT INTO tickets (household_id, issued_at, expires_at, source, status, note, op_id)
           SELECT ?1, ?2, ?3, 'points', 'unused', 'ポイントと交換', ?4 WHERE ${balanceSql} >= ?5`,
        )
        .bind(householdId, nowIso, expiryFor(settings.ticket_expiry, now), op, need),
      db
        .prepare(
          `INSERT INTO point_ledger (household_id, delta, kind, ticket_id, reason, actor_type, actor_id, created_at, op_id)
           SELECT ?1, -?5, 'ticket_issue', ${ticketOfOp}, '無料券と交換', 'member', ?6, ?2, ?4
            WHERE ${ticketOfOp} IS NOT NULL`,
        )
        .bind(householdId, nowIso, null, op, need, args.memberId),
      // 操作ログ(お客さん自身の操作として残す)。管理者は操作ログから元に戻せる
      db
        .prepare(
          `INSERT INTO audit_log (actor_type, actor_id, action, target_type, target_id, after_value, undo_info, created_at)
           SELECT 'member', ?6, 'ticket.exchange', 'household', ?7,
                  json_object('ticketId', ${ticketOfOp}, 'points', ?5),
                  json_object('householdId', ?1, 'ticketId', ${ticketOfOp}, 'opId', ?4), ?2
            WHERE ${ticketOfOp} IS NOT NULL`,
        )
        .bind(householdId, nowIso, null, op, need, args.memberId, String(householdId)),
    ]);
  } catch (e) {
    // 同じ印の交換が先に書かれた(二重送信)。1回目の結果を返す
    if (/UNIQUE constraint failed: tickets\.op_id/.test(String((e as Error)?.message))) {
      const first = await findExchange(db, householdId, op);
      if (first) return exchangeResult(db, householdId, first, need, now);
    }
    throw e;
  }
  if (results[0]!.meta.changes !== 1) throw notEnoughPoints(await pointBalance(db, householdId), need);
  const created = await findExchange(db, householdId, op);
  return exchangeResult(db, householdId, created!, need, now);
}

async function findExchange(db: D1Database, householdId: number, op: string): Promise<number | null> {
  const row = await db
    .prepare('SELECT id FROM tickets WHERE op_id = ? AND household_id = ?')
    .bind(op, householdId)
    .first<{ id: number }>();
  return row?.id ?? null;
}

async function exchangeResult(db: D1Database, householdId: number, ticketId: number, need: number, now: Date): Promise<TicketExchangeResult> {
  return {
    ticketId,
    pointsUsed: need,
    balance: await pointBalance(db, householdId),
    unusedTickets: await unusedTicketCount(db, householdId, now),
  };
}

type TicketRow = {
  id: number;
  household_id: number;
  status: string;
  expires_at: string | null;
  used_at: string | null;
  used_visit_id: number | null;
};

async function getTicket(db: D1Database, id: number): Promise<TicketRow | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  return db
    .prepare('SELECT id, household_id, status, expires_at, used_at, used_visit_id FROM tickets WHERE id = ?')
    .bind(id)
    .first<TicketRow>();
}

/** 使えない無料券のエラー(使用済み・期限切れ・取り消し) */
function cannotUse(t: TicketRow, nowIso: string, who: 'member' | 'staff') {
  const reload = who === 'member' ? '会員証を開き直してください。' : '画面を読み込み直してください。';
  if (t.status === 'used') return errors.conflict('ticket_used', `この無料券は、もう使用済みです。${reload}`);
  if (t.status === 'expired' || (t.status === 'unused' && t.expires_at !== null && t.expires_at < nowIso)) {
    return errors.conflict(
      'ticket_expired',
      who === 'member'
        ? 'この無料券は有効期限が切れているため、使えません。分からないときは受付にお知らせください。'
        : 'この無料券は有効期限が切れているため、使用済みにできません。必要なら、ポイント・無料券の手動登録で調整してください。',
    );
  }
  return errors.conflict('ticket_void', `この無料券は取り消されているため、使えません。${reload}`);
}

/**
 * 無料券を使う(お客さんの「使用する」と、管理画面の「無料券を使用済みにする」で共通)。
 * - そのおうちの未使用の券だけ。使用済み・期限切れ・取り消しの券は使えない
 * - 使った日時(日本時間の今)を残し、その日の来場(取り消していないもの)があれば結びつける
 * - 同時に2回押されても、1回だけ使う(書き込みは「未使用なら」の条件つき)
 */
export async function useTicket(
  db: D1Database,
  args: { householdId: number; ticketId: number; actor: { type: 'member' | 'staff'; id: number }; now: Date; reason?: string | null },
): Promise<{ ticketId: number; usedAt: string; usedDate: string; visitId: number | null }> {
  const { householdId, now, actor } = args;
  const nowIso = toJstIso(now);
  const today = toJstDate(now);
  const t = await getTicket(db, args.ticketId);
  if (!t || t.household_id !== householdId) {
    throw errors.notFound(
      actor.type === 'member'
        ? '無料券が見つかりませんでした。会員証を開き直してください。'
        : '無料券が見つかりませんでした。おうちの詳細を読み込み直してください。',
    );
  }
  if (t.status !== 'unused' || (t.expires_at !== null && t.expires_at < nowIso)) throw cannotUse(t, nowIso, actor.type);

  const update = db
    .prepare(
      `UPDATE tickets SET status = 'used', used_at = ?3, used_visit_id = ${VISIT_OF_DAY}
        WHERE id = ?4 AND household_id = ?1 AND status = 'unused' AND (expires_at IS NULL OR expires_at >= ?3)`,
    )
    .bind(householdId, today, nowIso, t.id);
  const audit =
    actor.type === 'member'
      ? db
          .prepare(
            `INSERT INTO audit_log (actor_type, actor_id, action, target_type, target_id, before_value, after_value, undo_info, created_at)
             SELECT 'member', ?1, 'ticket.use', 'household', ?2, ?3, ?4, ?5, ?6 WHERE changes() = 1`,
          )
          .bind(
            actor.id,
            String(householdId),
            JSON.stringify({ ticketId: t.id, status: 'unused' }),
            JSON.stringify({ ticketId: t.id, status: 'used', usedAt: nowIso }),
            JSON.stringify({ householdId, ticketId: t.id, usedAt: nowIso }),
            nowIso,
          )
      : auditStatement(db, {
          staffId: actor.id,
          action: 'ticket.mark_used',
          targetType: 'household',
          targetId: householdId,
          before: { ticketId: t.id, status: 'unused' },
          after: { ticketId: t.id, status: 'used', usedAt: nowIso },
          reason: args.reason ?? null,
          undo: { householdId, ticketId: t.id, usedAt: nowIso },
          now,
          onlyIf: { sql: 'changes() = 1', args: [] },
        });
  const [res] = await db.batch([update, audit]);
  if (res!.meta.changes !== 1) {
    const again = await getTicket(db, t.id);
    throw cannotUse(again ?? t, nowIso, actor.type);
  }
  const used = (await getTicket(db, t.id))!;
  await refreshDailyStatsQuietly(db, today, now);
  return { ticketId: t.id, usedAt: nowIso, usedDate: today, visitId: used.used_visit_id };
}

/** 使った無料券の表示内容(「無料券を使用しました」の画面、C-06) */
export async function ticketUseDetail(
  db: D1Database,
  member: { householdId: number; memberNo: string; householdName: string },
  ticketId: number,
  now: Date,
): Promise<TicketUseDetail> {
  const t = await getTicket(db, ticketId);
  if (!t || t.household_id !== member.householdId || t.status !== 'used' || !t.used_at) {
    throw errors.notFound('使った無料券が見つかりませんでした。会員証を開き直してください。');
  }
  const usedDate = t.used_at.slice(0, 10);
  return {
    ticketId: t.id,
    memberNo: member.memberNo,
    householdName: member.householdName,
    usedAt: t.used_at,
    usedDate,
    isToday: usedDate === toJstDate(now),
    visitId: t.used_visit_id,
    serverTime: toJstIso(now),
    unusedTickets: await unusedTicketCount(db, member.householdId, now),
  };
}

/** 管理画面での「無料券を使用済みにする」の結果 */
export async function markTicketUsed(
  db: D1Database,
  args: { householdId: number; ticketId: number; staffId: number; now: Date },
): Promise<AdminTicketUseResult> {
  const r = await useTicket(db, {
    householdId: args.householdId,
    ticketId: args.ticketId,
    actor: { type: 'staff', id: args.staffId },
    now: args.now,
  });
  return { ticketId: r.ticketId, usedAt: r.usedAt, visitId: r.visitId };
}

/**
 * 無料券の記録(来場履歴 L-08)。交換と使用を新しい順に。統合でまとめたおうちの分も含める(5.3)。
 * 交換は台帳の「無料券と交換」の行(元に戻したものと、取り消しで回収した券の分は除く)、使用は使用済みの券から出す。
 */
export async function ticketHistory(db: D1Database, householdId: number, limit = 50): Promise<TicketEvent[]> {
  const [exchanges, uses] = await db.batch([
    db
      .prepare(
        `WITH RECURSIVE ${MERGED_HOUSEHOLDS_CTE}
         SELECT l.ticket_id, l.created_at AS at, -l.delta AS points FROM point_ledger l
           JOIN tickets t ON t.id = l.ticket_id
          WHERE l.household_id IN (SELECT id FROM hh) AND l.kind = 'ticket_issue' AND l.delta < 0 AND l.reverses_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM point_ledger r WHERE r.reverses_id = l.id) AND t.status <> 'void'
          ORDER BY l.created_at DESC, l.id DESC LIMIT ${limit}`,
      )
      .bind(householdId),
    db
      .prepare(
        `WITH RECURSIVE ${MERGED_HOUSEHOLDS_CTE}
         SELECT id AS ticket_id, used_at AS at FROM tickets
          WHERE household_id IN (SELECT id FROM hh) AND status = 'used' AND used_at IS NOT NULL
          ORDER BY used_at DESC, id DESC LIMIT ${limit}`,
      )
      .bind(householdId),
  ]);
  const events: TicketEvent[] = [
    ...(exchanges!.results as { ticket_id: number; at: string; points: number }[]).map((r) => ({
      kind: 'exchange' as const,
      ticketId: r.ticket_id,
      at: r.at,
      points: r.points,
    })),
    ...(uses!.results as { ticket_id: number; at: string }[]).map((r) => ({ kind: 'use' as const, ticketId: r.ticket_id, at: r.at, points: 0 })),
  ];
  // 同じ時刻なら、使用を交換より上に(新しい順)
  events.sort((a, b) => (a.at === b.at ? (a.kind === 'use' ? -1 : 1) : a.at < b.at ? 1 : -1));
  return events.slice(0, limit);
}

/**
 * 無料券の使用を元に戻す(操作ログ A-15 から。お客さんの「使用する」と、管理画面の「使用済みにする」)。
 * 使ったときのまま(同じ使用日時)なら未使用に戻し、来場との結びつきを外す
 */
export async function undoTicketUse(db: D1Database, log: AuditRow, ctx: UndoContext): Promise<void> {
  const info = JSON.parse(log.undo_info ?? '{}') as { householdId?: number; ticketId?: number; usedAt?: string };
  const res = await db
    .prepare(
      `UPDATE tickets SET status = 'unused', used_at = NULL, used_visit_id = NULL
        WHERE id = ? AND household_id = ? AND status = 'used' AND used_at = ?`,
    )
    .bind(Number(info.ticketId) || 0, Number(info.householdId) || 0, String(info.usedAt ?? ''))
    .run();
  if (res.meta.changes !== 1) {
    throw errors.conflict(
      'ticket_changed',
      'この無料券は、そのあとに状態が変わったため戻せません。おうちの詳細で無料券の状態を確かめてください。',
    );
  }
  if (info.usedAt) await refreshDailyStatsQuietly(db, info.usedAt.slice(0, 10), ctx.now);
}

/**
 * 無料券との交換を元に戻す(操作ログ A-15 から)。
 * 券がまだ未使用なら取り消しにして、引いたポイントを戻す。使った券は戻せない
 */
export async function undoTicketExchange(db: D1Database, log: AuditRow, ctx: UndoContext): Promise<void> {
  const info = JSON.parse(log.undo_info ?? '{}') as { householdId?: number; ticketId?: number; opId?: string };
  const ticketId = Number(info.ticketId) || 0;
  const householdId = Number(info.householdId) || 0;
  const t = await getTicket(db, ticketId);
  if (!t || t.household_id !== householdId) {
    throw errors.conflict('ticket_changed', 'この無料券は、おうちの統合などで移っているため戻せません。ポイント・無料券の手動登録で調整してください。');
  }
  if (t.status !== 'unused') {
    throw errors.conflict(
      'ticket_changed',
      'この無料券は、もう使われているか期限切れのため、交換を元に戻せません。必要なら、ポイント・無料券の手動登録で調整してください。',
    );
  }
  const nowIso = toJstIso(ctx.now);
  const [voided] = await db.batch([
    db
      .prepare(`UPDATE tickets SET status = 'void', note = '無料券との交換を元に戻した' WHERE id = ? AND status = 'unused'`)
      .bind(ticketId),
    db
      .prepare(
        `INSERT INTO point_ledger (household_id, delta, kind, ticket_id, reason, actor_type, actor_id, created_at, reverses_id)
         SELECT household_id, -delta, 'ticket_issue', ticket_id, '無料券との交換を元に戻した', 'staff', ?, ?, id
           FROM point_ledger
          WHERE ticket_id = ? AND kind = 'ticket_issue' AND delta < 0 AND reverses_id IS NULL AND changes() = 1
            AND NOT EXISTS (SELECT 1 FROM point_ledger r WHERE r.reverses_id = point_ledger.id)`,
      )
      .bind(ctx.staffId, nowIso, ticketId),
  ]);
  if (voided!.meta.changes !== 1) {
    throw errors.conflict('ticket_changed', 'この無料券は、そのあとに状態が変わったため戻せません。画面を読み込み直してください。');
  }
}
