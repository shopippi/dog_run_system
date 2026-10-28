import {
  MIGRATION_SOURCE_LABELS,
  MIGRATION_SOURCES,
  expiryFor,
  isWithinMigrationPeriod,
  planMigration,
  toJstDate,
  toJstIso,
  type MigrationResult,
  type MigrationSource,
  type MigrationStatus,
  type Settings,
} from '@dr/shared';
import { errors } from '../lib/errors';
import { auditStatement } from './audit';
import { historyHouseholdIds } from './merges';
import { pointBalance } from './points';
import type { AuditRow, UndoContext } from './undo';

/*
 * 旧カードからの移行(A-05、要件定義書 16章)。
 * - 台帳に「移行」(kind = migration、migration_source)として記録する。無料券1枚分以上になれば、その時点で発行する
 * - 移行元ごとに1おうち1回まで(19.2)。統合でまとめたおうちの分も数える。元に戻した記録は数えない
 * - 移行期間(settings の migration_period)の外は受け付けない。期間が未設定なら受け付ける
 * - 発行した無料券の台帳の行にも migration_source を入れ、元に戻すときに辿れるようにする
 */

const DATE = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${m}月${d}日`;
};

/** まだ元に戻していない移行の記録(そのおうちと、統合でまとめたおうち) */
const ACTIVE_MIGRATION = `kind = 'migration' AND reverses_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM point_ledger r WHERE r.reverses_id = point_ledger.id)`;

async function migratedRecords(db: D1Database, householdIds: number[]) {
  const { results } = await db
    .prepare(
      `SELECT id, household_id, migration_source, delta, created_at FROM point_ledger
        WHERE household_id IN (${householdIds.map(() => '?').join(',')}) AND ${ACTIVE_MIGRATION}
        ORDER BY id`,
    )
    .bind(...householdIds)
    .all<{ id: number; household_id: number; migration_source: MigrationSource; delta: number; created_at: string }>();
  return results;
}

type HouseholdRow = { id: number; member_no: string; display_name: string; status: string; merged_into_id: number | null };

async function getHousehold(db: D1Database, id: number) {
  return db
    .prepare('SELECT id, member_no, display_name, status, merged_into_id FROM households WHERE id = ?')
    .bind(id)
    .first<HouseholdRow>();
}

/** 統合済みのおうちなら、統合先(今使っているおうち)をたどる */
export async function resolveActiveHousehold(db: D1Database, id: number): Promise<HouseholdRow | null> {
  let h = await getHousehold(db, id);
  for (let i = 0; h && h.status === 'merged' && h.merged_into_id && i < 20; i++) h = await getHousehold(db, h.merged_into_id);
  return h;
}

export async function migrationStatus(db: D1Database, householdId: number, now: Date, settings: Settings): Promise<MigrationStatus> {
  const h = await getHousehold(db, householdId);
  if (!h) throw errors.notFound('おうちが見つかりませんでした。画面を読み込み直して、選び直してください。');
  const records = await migratedRecords(db, await historyHouseholdIds(db, h.id));
  const migrated = Object.fromEntries(
    MIGRATION_SOURCES.map((s) => {
      const r = records.find((x) => x.migration_source === s);
      return [s, r ? { date: r.created_at, points: r.delta } : null];
    }),
  ) as MigrationStatus['migrated'];
  return {
    householdId: h.id,
    memberNo: h.member_no,
    displayName: h.display_name,
    points: await pointBalance(db, h.id),
    pointsPerTicket: settings.points_per_ticket,
    migrated,
    period: settings.migration_period,
    inPeriod: isWithinMigrationPeriod(settings.migration_period, toJstDate(now)),
  };
}

export function outsidePeriod(period: Settings['migration_period']) {
  const range = `${period.start ? DATE(period.start) : ''}〜${period.end ? DATE(period.end) : ''}`;
  return errors.conflict(
    'outside_migration_period',
    `旧カードの引き継ぎを受け付ける期間(${range})の外です。期間を変えるときは、ルールの設定で移行期間を直してください。`,
  );
}

/**
 * 移行を記録する(直接入力と、申請の承認で共通)。
 * periodDate: 移行期間の判定に使う日(直接入力は今日、申請は申請した日)
 */
export async function recordMigration(
  db: D1Database,
  args: {
    householdId: number;
    source: MigrationSource;
    points: number;
    staffId: number;
    now: Date;
    settings: Settings;
    periodDate: string;
    request?: { id: number; claimedPoints: number | null };
  },
): Promise<MigrationResult> {
  const { settings, now, source } = args;
  const h = await getHousehold(db, args.householdId);
  if (!h) throw errors.notFound('おうちが見つかりませんでした。画面を読み込み直して、選び直してください。');
  if (h.status === 'merged') {
    const to = await resolveActiveHousehold(db, h.id);
    throw errors.conflict(
      'household_merged',
      `このおうちは${to ? ` ${to.member_no} に` : ''}まとめられています。まとめた先のおうちで入力してください。`,
    );
  }
  if (h.status !== 'active') throw errors.conflict('not_active', 'このおうちは退会しているため、引き継げません。');
  if (!isWithinMigrationPeriod(settings.migration_period, args.periodDate)) throw outsidePeriod(settings.migration_period);

  const ids = await historyHouseholdIds(db, h.id);
  const already = (await migratedRecords(db, ids)).find((r) => r.migration_source === source);
  if (already) throw alreadyMigrated(source, already.created_at, Boolean(args.request));

  const nowIso = toJstIso(now);
  const balance = await pointBalance(db, h.id);
  const plan = planMigration(balance, args.points, settings.points_per_ticket);
  const reason = args.request
    ? `${MIGRATION_SOURCE_LABELS[source]}から引き継ぎ(申請を承認)`
    : `${MIGRATION_SOURCE_LABELS[source]}から引き継ぎ(受付で入力)`;
  const marks = ids.map(() => '?').join(',');

  const s: D1PreparedStatement[] = [
    // 同時に2回押されても1回だけ: すでに同じ移行元の記録があれば household_id が NULL になり、まとめ全体が取り消される
    db
      .prepare(
        `INSERT INTO point_ledger (household_id, delta, kind, migration_source, reason, actor_type, actor_id, created_at, expires_at)
         VALUES (CASE WHEN NOT EXISTS (
                   SELECT 1 FROM point_ledger WHERE household_id IN (${marks}) AND migration_source = ? AND ${ACTIVE_MIGRATION}
                 ) AND (? = 0 OR EXISTS (SELECT 1 FROM requests WHERE id = ? AND status = 'pending'))
                 THEN ? END, ?, 'migration', ?, ?, 'staff', ?, ?, ?)`,
      )
      .bind(
        ...ids,
        source,
        args.request ? 1 : 0,
        args.request?.id ?? 0,
        h.id,
        args.points,
        source,
        reason,
        args.staffId,
        nowIso,
        args.points > 0 ? expiryFor(settings.point_expiry, now) : null,
      ),
  ];
  for (const entry of plan.ledger) {
    if (entry.kind !== 'ticket_issue') continue;
    s.push(
      db
        .prepare(`INSERT INTO tickets (household_id, issued_at, expires_at, source, status, note) VALUES (?, ?, ?, 'migration', 'unused', ?)`)
        .bind(h.id, nowIso, expiryFor(settings.ticket_expiry, now), '旧カードの引き継ぎでポイントがたまったため'),
      db
        .prepare(
          `INSERT INTO point_ledger (household_id, delta, kind, ticket_id, migration_source, reason, actor_type, actor_id, created_at)
           VALUES (?, ?, 'ticket_issue', (SELECT MAX(id) FROM tickets), ?, ?, 'staff', ?, ?)`,
        )
        .bind(h.id, entry.delta, source, reason, args.staffId, nowIso),
    );
  }
  if (args.request) {
    const note =
      args.request.claimedPoints !== null && args.request.claimedPoints !== args.points
        ? `${args.points}ポイントで承認(申請は${args.request.claimedPoints}ポイント)`
        : `${args.points}ポイントで承認`;
    s.push(
      db
        .prepare(
          `UPDATE requests SET status = 'approved', handled_by_staff_id = ?, handled_at = ?, handle_note = ?
            WHERE id = ? AND status = 'pending'`,
        )
        .bind(args.staffId, nowIso, note, args.request.id),
    );
  }
  s.push(
    auditStatement(db, {
      staffId: args.staffId,
      action: 'household.migrate',
      targetType: 'household',
      targetId: h.id,
      before: { points: balance },
      after: {
        points: plan.balanceAfter,
        source,
        migratedPoints: args.points,
        ticketsIssued: plan.ticketsIssued,
        requestId: args.request?.id ?? null,
      },
      reason,
      undo: { householdId: h.id, source, createdAt: nowIso, requestId: args.request?.id ?? null },
      now,
    }),
  );
  try {
    await db.batch(s);
  } catch (e) {
    if (/NOT NULL constraint failed: point_ledger\.household_id/.test(String((e as Error)?.message))) {
      // 同時に押された: 申請がその間に処理されたか、同じ移行元の記録が先に入った
      if (args.request) {
        const r = await db.prepare('SELECT status FROM requests WHERE id = ?').bind(args.request.id).first<{ status: string }>();
        if (r?.status !== 'pending') {
          throw errors.conflict('request_handled', 'この申請は、すでに処理されています。確認待ちの画面を読み込み直してください。');
        }
      }
      throw alreadyMigrated(source, nowIso, Boolean(args.request));
    }
    throw e;
  }
  return {
    householdId: h.id,
    memberNo: h.member_no,
    source,
    points: args.points,
    ticketsIssued: plan.ticketsIssued,
    balance: plan.balanceAfter,
  };
}

function alreadyMigrated(source: MigrationSource, at: string, isRequest: boolean) {
  return errors.conflict(
    'already_migrated',
    `このおうちは、${MIGRATION_SOURCE_LABELS[source]}の引き継ぎが${DATE(at)}に済んでいます。同じカードは1回だけ引き継げます。` +
      (isRequest ? 'この申請は「却下する」で、理由「すでに引き継ぎ済み」を選んでください。' : ''),
  );
}

/**
 * 移行を元に戻す(操作ログ A-15 から)。
 * 移行の台帳の行と、そのとき発行した無料券の行を打ち消す行を足し、無料券を回収する。
 * 発行した無料券が使われていれば戻せない。申請の承認だった場合は、申請を確認待ちに戻す。
 */
export async function undoMigration(db: D1Database, log: AuditRow, ctx: UndoContext): Promise<void> {
  const info = JSON.parse(log.undo_info ?? '{}') as {
    householdId: number;
    source: MigrationSource;
    createdAt: string;
    requestId: number | null;
  };
  const row = await db
    .prepare(
      `SELECT id, delta FROM point_ledger WHERE household_id = ? AND migration_source = ? AND created_at = ? AND ${ACTIVE_MIGRATION}`,
    )
    .bind(info.householdId, info.source, info.createdAt)
    .first<{ id: number; delta: number }>();
  if (!row) throw errors.conflict('already_undone', 'この引き継ぎは、すでに元に戻されています。画面を読み込み直してください。');
  const h = await getHousehold(db, info.householdId);
  if (!h || h.status !== 'active') {
    throw errors.conflict(
      'household_merged',
      'このおうちは引き継ぎのあとに統合されたため、元に戻せません。ポイントの手動登録で調整してください。',
    );
  }
  const { results: issued } = await db
    .prepare(
      `SELECT l.id, l.delta, l.ticket_id, t.status FROM point_ledger l JOIN tickets t ON t.id = l.ticket_id
        WHERE l.household_id = ? AND l.kind = 'ticket_issue' AND l.migration_source = ? AND l.created_at = ?
          AND l.reverses_id IS NULL AND t.source = 'migration'`,
    )
    .bind(info.householdId, info.source, info.createdAt)
    .all<{ id: number; delta: number; ticket_id: number; status: string }>();
  if (issued.some((t) => t.status === 'used')) {
    throw errors.conflict(
      'ticket_already_used',
      '引き継ぎで発行した無料券が、もう使われているため元に戻せません。ポイントの手動登録で調整してください。',
    );
  }
  const nowIso = toJstIso(ctx.now);
  const reason = `${MIGRATION_SOURCE_LABELS[info.source]}の引き継ぎを元に戻した`;
  const notYet = 'NOT EXISTS (SELECT 1 FROM point_ledger WHERE reverses_id = ?)';
  const s: D1PreparedStatement[] = [
    ...issued.map((t) =>
      db
        .prepare(`UPDATE tickets SET status = 'void', note = ? WHERE id = ? AND status = 'unused' AND ${notYet}`)
        .bind('旧カードの引き継ぎを元に戻したため回収', t.ticket_id, row.id),
    ),
    ...issued.map((t) =>
      db
        .prepare(
          `INSERT INTO point_ledger (household_id, delta, kind, ticket_id, migration_source, reason, actor_type, actor_id, created_at, reverses_id)
           SELECT ?, ?, 'ticket_issue', ?, ?, ?, 'staff', ?, ?, ? WHERE ${notYet}`,
        )
        .bind(info.householdId, -t.delta, t.ticket_id, info.source, reason, ctx.staffId, nowIso, t.id, row.id),
    ),
    db
      .prepare(
        `INSERT INTO point_ledger (household_id, delta, kind, migration_source, reason, actor_type, actor_id, created_at, reverses_id)
         SELECT ?, ?, 'migration', ?, ?, 'staff', ?, ?, ? WHERE ${notYet}`,
      )
      .bind(info.householdId, -row.delta, info.source, reason, ctx.staffId, nowIso, row.id, row.id),
  ];
  if (info.requestId) {
    s.push(
      db
        .prepare(
          `UPDATE requests SET status = 'pending', handled_by_staff_id = NULL, handled_at = NULL, handle_note = NULL
            WHERE id = ? AND status = 'approved'`,
        )
        .bind(info.requestId),
    );
  }
  s.push(
    db.prepare('UPDATE audit_log SET undone_at = ?, undone_by_staff_id = ? WHERE id = ? AND undone_at IS NULL').bind(nowIso, ctx.staffId, log.id),
    auditStatement(db, {
      staffId: ctx.staffId,
      action: 'household.migrate_undo',
      targetType: 'household',
      targetId: info.householdId,
      before: { migratedPoints: row.delta, ticketsVoided: issued.map((t) => t.ticket_id) },
      after: { migratedPoints: 0 },
      reason,
      now: ctx.now,
    }),
  );
  await db.batch(s);
}
