import {
  MIGRATION_SOURCE_LABELS,
  MIGRATION_SOURCES,
  expiryFor,
  isWithinMigrationPeriod,
  migrationPointsError,
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
 * 旧カードからの移行(A-05、要件定義書 16章)。受付で旧カードを見せてもらい、管理者が直接入力する(対面だけ)。
 * - 台帳に「移行」(kind = migration、migration_source)として記録する。無料券1枚分以上になっても自動では交換しない(8章)
 * - 一度に引き継げるポイントは設定 migration_max_points(初期値 30)まで
 * - 移行元ごとに1おうち1回まで(19.2)。統合でまとめたおうちの分も数える。元に戻した記録は数えない
 * - 移行期間(settings の migration_period)の外は受け付けない。期間が未設定なら受け付ける
 * - 以前の記録(移行で無料券を発行していたころ)の無料券の行にも migration_source があり、元に戻すときに辿る
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
    maxPoints: settings.migration_max_points,
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
 * 移行を記録する(受付での直接入力。16.1)。
 * 旧カードを目で確かめたことと、紙のカードを回収した(または使用済みの印を付けた)ことは、入力チェックで必須にしている
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
  },
): Promise<MigrationResult> {
  const { settings, now, source } = args;
  const tooMany = migrationPointsError(args.points, settings.migration_max_points);
  if (tooMany) throw errors.badRequest(tooMany, { maxPoints: settings.migration_max_points });
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
  if (!isWithinMigrationPeriod(settings.migration_period, toJstDate(now))) throw outsidePeriod(settings.migration_period);

  const ids = await historyHouseholdIds(db, h.id);
  const already = (await migratedRecords(db, ids)).find((r) => r.migration_source === source);
  if (already) throw alreadyMigrated(source, already.created_at);

  const nowIso = toJstIso(now);
  const balance = await pointBalance(db, h.id);
  const plan = planMigration(balance, args.points);
  const reason = `${MIGRATION_SOURCE_LABELS[source]}から引き継ぎ(受付で旧カードを確認)`;
  const marks = ids.map(() => '?').join(',');

  const s: D1PreparedStatement[] = [
    // 同時に2回押されても1回だけ: すでに同じ移行元の記録があれば household_id が NULL になり、まとめ全体が取り消される
    db
      .prepare(
        `INSERT INTO point_ledger (household_id, delta, kind, migration_source, reason, actor_type, actor_id, created_at, expires_at)
         VALUES (CASE WHEN NOT EXISTS (
                   SELECT 1 FROM point_ledger WHERE household_id IN (${marks}) AND migration_source = ? AND ${ACTIVE_MIGRATION}
                 ) THEN ? END, ?, 'migration', ?, ?, 'staff', ?, ?, ?)`,
      )
      .bind(
        ...ids,
        source,
        h.id,
        args.points,
        source,
        reason,
        args.staffId,
        nowIso,
        args.points > 0 ? expiryFor(settings.point_expiry, now) : null,
      ),
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
        confirmedCard: true,
        collectedCard: true,
      },
      reason,
      undo: { householdId: h.id, source, createdAt: nowIso, requestId: null },
      now,
    }),
  ];
  try {
    await db.batch(s);
  } catch (e) {
    if (/NOT NULL constraint failed: point_ledger\.household_id/.test(String((e as Error)?.message))) {
      // 同時に押された: 同じ移行元の記録が先に入った
      throw alreadyMigrated(source, nowIso);
    }
    throw e;
  }
  return {
    householdId: h.id,
    memberNo: h.member_no,
    source,
    points: args.points,
    balance: plan.balanceAfter,
  };
}

function alreadyMigrated(source: MigrationSource, at: string) {
  return errors.conflict(
    'already_migrated',
    `このおうちは、${MIGRATION_SOURCE_LABELS[source]}の引き継ぎが${DATE(at)}に済んでいます。同じカードは1回だけ引き継げます。` +
      '旧カードはお返しせず、引き継ぎ済みとお伝えください。間違えて入力したときは、「旧カードの引き継ぎ」の一覧から元に戻してから入力し直してください。',
  );
}

/**
 * 移行を元に戻す(操作ログ A-15 から)。
 * 移行の台帳の行を打ち消す行を足す。以前の記録で、そのとき発行した無料券があれば、その行も打ち消して券を回収する
 * (発行した無料券が使われていれば戻せない)。以前の申請の承認だった場合は、申請を確認待ちに戻す。
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
