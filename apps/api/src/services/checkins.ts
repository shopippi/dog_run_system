import { expiryFor, planCheckin, toJstDate, toJstIso, type CheckinResult, type Settings, type TodayVisit, type VisitMethod } from '@dr/shared';
import { errors } from '../lib/errors';
import { auditStatement } from './audit';
import { nextUsableTicket, pointBalance } from './points';

/** そのおうちの、指定した日の来場(取り消し済みを除く) */
export async function findVisitOn(db: D1Database, householdId: number, date: string) {
  return db
    .prepare(
      `SELECT v.id, v.checked_in_member_id, v.used_ticket, COALESCE(m.line_display_name, '') AS checked_in_by
         FROM visits v LEFT JOIN family_members m ON m.id = v.checked_in_member_id
        WHERE v.household_id = ? AND v.visit_date = ? AND v.cancelled_at IS NULL`,
    )
    .bind(householdId, date)
    .first<{ id: number; checked_in_member_id: number | null; used_ticket: number; checked_in_by: string }>();
}

export async function todayVisit(db: D1Database, householdId: number, memberId: number, now: Date): Promise<TodayVisit | null> {
  const v = await findVisitOn(db, householdId, toJstDate(now));
  if (!v) return null;
  const { results } = await db.prepare('SELECT dog_id FROM visit_dogs WHERE visit_id = ? ORDER BY id').bind(v.id).all<{ dog_id: number }>();
  return {
    id: v.id,
    checkedInBy: v.checked_in_by,
    isMe: v.checked_in_member_id === memberId,
    dogIds: results.map((r) => r.dog_id),
    usedTicket: v.used_ticket === 1,
  };
}

/** 犬がそのおうちの登録中の犬かを確かめる */
export async function requireActiveDogs(db: D1Database, householdId: number, dogIds: number[]): Promise<number[]> {
  const ids = [...new Set(dogIds)];
  const { results } = await db
    .prepare(
      `SELECT id FROM dogs WHERE household_id = ? AND status = 'active' AND id IN (${ids.map(() => '?').join(',')})`,
    )
    .bind(householdId, ...ids)
    .all<{ id: number }>();
  if (results.length !== ids.length) {
    throw errors.badRequest('ワンちゃんの登録が変わりました。画面を読み込み直して、選び直してください。');
  }
  return ids;
}

export const alreadyCheckedIn = (visit: { id: number; checked_in_by: string }) =>
  errors.conflict(
    'already_checked_in',
    visit.checked_in_by
      ? `今日は${visit.checked_in_by}さんがチェックイン済みです。ポイントは1日1回です。一緒に来たワンちゃんの追加だけができます。`
      : '今日はすでにチェックイン済みです。ポイントは1日1回です。',
    { visitId: visit.id },
  );

/**
 * チェックインを記録する(C-04、S-04)。
 * 来場・来場した犬・ポイント・無料券の発行と利用を、1つのまとまり(D1 の batch)で書き込む。
 * おうちごとに1日1回は、visits の一意の索引で守る(同時に2人が押しても、2回目は失敗する)。
 */
export async function recordCheckin(
  db: D1Database,
  args: {
    householdId: number;
    memberId: number | null;
    staffId: number | null;
    method: VisitMethod;
    dogIds: number[];
    useTicket: boolean;
    visitDate: string;
    now: Date;
    settings: Settings;
    /** 同じまとまりで書き込む追加の処理(操作ログなど) */
    extra?: D1PreparedStatement[];
  },
): Promise<CheckinResult> {
  const { householdId, visitDate, now, settings } = args;
  const nowIso = toJstIso(now);

  const existing = await findVisitOn(db, householdId, visitDate);
  if (existing) throw alreadyCheckedIn(existing);

  let ticketId: number | null = null;
  if (args.useTicket) {
    ticketId = await nextUsableTicket(db, householdId, now);
    if (!ticketId) throw errors.badRequest('使える無料券がありません。「無料券を使う」を外して、もう一度お試しください。');
  }

  const balance = await pointBalance(db, householdId);
  const plan = planCheckin({ balance, useTicket: args.useTicket, settings });
  const actorType = args.staffId ? 'staff' : 'member';
  const actorId = args.staffId ?? args.memberId;
  const visitIdSql = `(SELECT id FROM visits WHERE household_id = ?1 AND visit_date = ?2 AND cancelled_at IS NULL)`;

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO visits (household_id, checked_in_member_id, visit_date, checked_in_at, dog_count, used_ticket,
                             method, created_by_staff_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(householdId, args.memberId, visitDate, nowIso, args.dogIds.length, args.useTicket ? 1 : 0, args.method, args.staffId),
    ...args.dogIds.map((dogId) =>
      db
        .prepare(
          `INSERT INTO visit_dogs (visit_id, dog_id, visit_date, added_by_member_id, created_at)
           VALUES (${visitIdSql}, ?3, ?2, ?4, ?5)`,
        )
        .bind(householdId, visitDate, dogId, args.memberId, nowIso),
    ),
  ];

  for (const entry of plan.ledger) {
    if (entry.kind === 'visit') {
      statements.push(
        db
          .prepare(
            `INSERT INTO point_ledger (household_id, delta, kind, visit_id, actor_type, actor_id, created_at, expires_at)
             VALUES (?1, ?3, 'visit', ${visitIdSql}, ?4, ?5, ?6, ?7)`,
          )
          .bind(householdId, visitDate, entry.delta, actorType, actorId, nowIso, expiryFor(settings.point_expiry, now)),
      );
    } else {
      // ポイントがたまったので無料券を発行し、その分のポイントを差し引く
      statements.push(
        db
          .prepare(
            `INSERT INTO tickets (household_id, issued_at, expires_at, source, issued_visit_id, status)
             VALUES (?1, ?3, ?4, 'points', ${visitIdSql}, 'unused')`,
          )
          .bind(householdId, visitDate, nowIso, expiryFor(settings.ticket_expiry, now)),
        db
          .prepare(
            `INSERT INTO point_ledger (household_id, delta, kind, visit_id, ticket_id, actor_type, actor_id, created_at)
             VALUES (?1, ?3, 'ticket_issue', ${visitIdSql}, (SELECT MAX(id) FROM tickets WHERE household_id = ?1), ?4, ?5, ?6)`,
          )
          .bind(householdId, visitDate, entry.delta, actorType, actorId, nowIso),
      );
    }
  }

  if (ticketId) {
    statements.push(
      db
        .prepare(
          `UPDATE tickets SET status = 'used', used_visit_id = ${visitIdSql}, used_at = ?3
            WHERE id = ?4 AND status = 'unused'`,
        )
        .bind(householdId, visitDate, nowIso, ticketId),
    );
  }

  statements.push(...(args.extra ?? []));
  let results: D1Result[];
  try {
    results = await db.batch(statements);
  } catch (e) {
    if (/UNIQUE constraint failed: visits/.test(String((e as Error)?.message))) {
      const v = await findVisitOn(db, householdId, visitDate);
      if (v) throw alreadyCheckedIn(v);
    }
    throw e;
  }
  const visitId = results[0]!.meta.last_row_id;
  return {
    visitId,
    pointsAwarded: plan.pointsAwarded,
    ticketsIssued: plan.ticketsIssued,
    usedTicket: args.useTicket,
    balanceAfter: plan.balanceAfter,
  };
}

/** 同じ日に家族が来たとき、来場に犬を加える(5.5)。ポイントは増えない。 */
export async function addDogsToVisit(
  db: D1Database,
  visitId: number,
  visitDate: string,
  dogIds: number[],
  memberId: number | null,
  now: Date,
) {
  const nowIso = toJstIso(now);
  await db.batch([
    ...dogIds.map((dogId) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO visit_dogs (visit_id, dog_id, visit_date, added_by_member_id, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(visitId, dogId, visitDate, memberId, nowIso),
    ),
    db
      .prepare('UPDATE visits SET dog_count = (SELECT COUNT(*) FROM visit_dogs WHERE visit_id = ?1) WHERE id = ?1')
      .bind(visitId),
  ]);
}

/**
 * チェックインを取り消す(S-03)。付けたポイントと使った無料券を元に戻す(8章)。
 * - その来場でポイントがたまって発行された無料券は回収する(使われていれば取り消せない)
 * - 来場の記録は消さず「取り消し済み」にする。取り消した日は、もう一度チェックインできる
 * - 同時に2回押されても、二重に戻さない(書き込みはすべて「まだ取り消されていなければ」の条件つき)
 */
export async function cancelCheckin(
  db: D1Database,
  args: { visitId: number; staffId: number; reason: string; now: Date },
): Promise<void> {
  const nowIso = toJstIso(args.now);
  const visit = await db
    .prepare('SELECT id, household_id, visit_date, used_ticket, dog_count, method, cancelled_at FROM visits WHERE id = ?')
    .bind(args.visitId)
    .first<{
      id: number;
      household_id: number | null;
      visit_date: string;
      used_ticket: number;
      dog_count: number;
      method: string;
      cancelled_at: string | null;
    }>();
  if (!visit) throw errors.notFound('チェックインが見つかりませんでした。画面を読み込み直してください。');
  if (visit.cancelled_at) {
    throw errors.conflict('already_cancelled', 'このチェックインは、すでに取り消されています。画面を読み込み直してください。');
  }

  const { results: issued } = await db
    .prepare("SELECT id, status FROM tickets WHERE issued_visit_id = ? AND status <> 'void'")
    .bind(visit.id)
    .all<{ id: number; status: string }>();
  if (issued.some((t) => t.status === 'used')) {
    throw errors.conflict(
      'ticket_already_used',
      'この来場でたまって発行された無料券が、もう使われているため取り消せません。ポイントの手動登録で調整してください。',
    );
  }
  const ledgerSum = await db
    .prepare('SELECT COALESCE(SUM(delta), 0) AS n FROM point_ledger WHERE visit_id = ?')
    .bind(visit.id)
    .first<{ n: number }>();

  const stillOpen = { sql: 'EXISTS (SELECT 1 FROM visits WHERE id = ? AND cancelled_at IS NULL)', args: [visit.id] };
  const statements: D1PreparedStatement[] = [];
  if (visit.household_id && (ledgerSum?.n ?? 0) !== 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO point_ledger (household_id, delta, kind, visit_id, reason, actor_type, actor_id, created_at)
           SELECT ?, ?, 'cancel', ?, ?, 'staff', ?, ? WHERE ${stillOpen.sql}`,
        )
        .bind(visit.household_id, -(ledgerSum?.n ?? 0), visit.id, args.reason, args.staffId, nowIso, ...stillOpen.args),
    );
  }
  // 発行した無料券を回収し、使った無料券を未使用に戻す
  statements.push(
    db
      .prepare(`UPDATE tickets SET status = 'void', note = ? WHERE issued_visit_id = ? AND status = 'unused' AND ${stillOpen.sql}`)
      .bind('来場の取り消しで回収', visit.id, ...stillOpen.args),
    db
      .prepare(
        `UPDATE tickets SET status = 'unused', used_visit_id = NULL, used_at = NULL
          WHERE used_visit_id = ? AND status = 'used' AND ${stillOpen.sql}`,
      )
      .bind(visit.id, ...stillOpen.args),
    auditStatement(db, {
      staffId: args.staffId,
      action: 'visit.cancel',
      targetType: 'visit',
      targetId: visit.id,
      before: { cancelled: false, points: ledgerSum?.n ?? 0, usedTicket: visit.used_ticket === 1, issuedTickets: issued.map((t) => t.id) },
      after: { cancelled: true },
      reason: args.reason,
      undo: { visitId: visit.id },
      now: args.now,
      onlyIf: stillOpen,
    }),
    db
      .prepare(
        `UPDATE visits SET cancelled_at = ?, cancel_reason = ?, cancelled_by_staff_id = ? WHERE id = ? AND cancelled_at IS NULL`,
      )
      .bind(nowIso, args.reason, args.staffId, visit.id),
  );
  const results = await db.batch(statements);
  if (results.at(-1)!.meta.changes !== 1) {
    throw errors.conflict('already_cancelled', 'このチェックインは、すでに取り消されています。画面を読み込み直してください。');
  }
}
