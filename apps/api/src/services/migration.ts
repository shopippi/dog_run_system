import {
  MIGRATION_SOURCE_LABELS,
  MIGRATION_SOURCES,
  capMigrationPoints,
  expiryFor,
  migrationPhase,
  normalizeCardRef,
  type MigrationDuplicate,
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
export const ACTIVE_MIGRATION = `kind = 'migration' AND reverses_id IS NULL
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
  const today = toJstDate(now);
  return {
    householdId: h.id,
    memberNo: h.member_no,
    displayName: h.display_name,
    points: await pointBalance(db, h.id),
    pointsPerTicket: settings.points_per_ticket,
    maxPoints: settings.migration_max_points,
    migrated,
    period: settings.migration_period,
    inPeriod: isWithinMigrationPeriod(settings.migration_period, today),
    phase: migrationPhase(settings.migration_period, today),
    lateEntry: settings.migration_late_entry,
    maxTickets: settings.migration_max_tickets,
  };
}

export function outsidePeriod(period: Settings['migration_period']) {
  const range = `${period.start ? DATE(period.start) : ''}〜${period.end ? DATE(period.end) : ''}`;
  return errors.conflict(
    'outside_migration_period',
    `旧カードの引き継ぎを受け付ける期間(${range})の外です。期間を変えるときは、ルールの設定で移行期間を直してください。`,
  );
}

/** 同じカードの番号で引き継いだ、ほかのおうちの記録(元に戻したものは除く) */
export async function sameCardRecords(
  db: D1Database,
  args: { cardRefSearch: string; source: MigrationSource; excludeHouseholdIds: number[] },
): Promise<MigrationDuplicate[]> {
  const ex = args.excludeHouseholdIds;
  const { results } = await db
    .prepare(
      `SELECT h.member_no, h.display_name, c.created_at, c.source FROM migration_cards c JOIN households h ON h.id = c.household_id
        WHERE c.card_ref_search = ? AND c.source = ? AND c.undone_at IS NULL
          ${ex.length ? `AND c.household_id NOT IN (${ex.map(() => '?').join(',')})` : ''}
        ORDER BY c.id`,
    )
    .bind(args.cardRefSearch, args.source, ...ex)
    .all<{ member_no: string; display_name: string; created_at: string; source: MigrationSource }>();
  return results.map((r) => ({ memberNo: r.member_no, householdName: r.display_name, at: r.created_at, source: r.source }));
}

export type MigrationArgs = {
  householdId: number;
  source: MigrationSource;
  /** 引き継ぐポイント(台帳に書く数) */
  points: number;
  /** 旧カードに残っていたポイント(上限で切る前の数)。なければ points と同じ */
  cardPoints?: number;
  /** 旧カードの使っていない特典から出す無料券の枚数 */
  tickets?: number;
  cardRef?: string;
  note?: string;
  duplicateOk?: boolean;
  lateReason?: string;
  staffId: number;
  now: Date;
  settings: Settings;
};

/**
 * 移行を記録する(受付での直接入力。16.1)。
 * 旧カードを目で確かめたことと、紙のカードを回収した(または使用済みの印を付けた)ことは、入力チェックで必須にしている
 */
export async function recordMigration(db: D1Database, args: MigrationArgs): Promise<MigrationResult> {
  const { settings, now, source } = args;
  const max = settings.migration_max_points;
  const tooMany = migrationPointsError(args.points, max);
  if (tooMany) throw errors.badRequest(tooMany, { maxPoints: max });
  const cardPoints = args.cardPoints ?? args.points;
  // 引き継ぐ数を旧カードの数より減らしてよいのは、上限で切るときだけ
  if (cardPoints !== args.points && args.points !== capMigrationPoints(cardPoints, max).points) {
    throw errors.badRequest('旧カードのポイント数と、引き継ぐポイント数が合いません。旧カードのポイント数を入れ直してください。', {
      maxPoints: max,
    });
  }
  const tickets = args.tickets ?? 0;
  if (tickets > settings.migration_max_tickets) {
    throw errors.badRequest(
      settings.migration_max_tickets === 0
        ? '旧カードの特典は、無料券にしない設定になっています。無料券を出すときは、ルールの設定で「旧カードの特典から出せる無料券の上限」を変えてください。'
        : `旧カードの特典から出せる無料券は、最大${settings.migration_max_tickets}枚です。`,
      { maxTickets: settings.migration_max_tickets },
    );
  }
  const h = await getHousehold(db, args.householdId);
  if (!h) throw errors.notFound('おうちが見つかりませんでした。画面を読み込み直して、選び直してください。');
  if (h.status === 'merged') {
    const to = await resolveActiveHousehold(db, h.id);
    throw errors.conflict(
      'household_merged',
      `このおうちは${to ? ` ${to.member_no} に` : ''}まとめられています。まとめた先のおうちで入力してください。`,
    );
  }
  if (h.status !== 'active') throw errors.conflict('not_active', 'このおうちは退会しているため、引き継げません。引き継ぎが必要なときは、製作者に相談してください。');

  // 移行期間(16.2)。終わったあとは、設定で「理由を書けば受け付ける」にしたときだけ、理由つきで受け付ける
  const phase = migrationPhase(settings.migration_period, toJstDate(now));
  const lateReason = args.lateReason?.trim() || null;
  if (phase === 'before' || (phase === 'after' && !settings.migration_late_entry)) throw outsidePeriod(settings.migration_period);
  if (phase === 'after' && !lateReason) {
    throw errors.badRequest('移行期間が終わっています。期間のあとに受け付ける理由を入れてください(例: 期間中に来られなかった)。', {
      lateReasonRequired: true,
    });
  }

  const ids = await historyHouseholdIds(db, h.id);
  const already = (await migratedRecords(db, ids)).find((r) => r.migration_source === source);
  if (already) throw alreadyMigrated(source, already.created_at);

  // 同じカードの番号が、ほかのおうちで引き継がれていないか(同じカードを2つのおうちで使う不正・入力ミスを防ぐ)
  const cardRef = args.cardRef?.trim() || null;
  const cardRefSearch = normalizeCardRef(cardRef);
  const dups = cardRefSearch ? await sameCardRecords(db, { cardRefSearch, source, excludeHouseholdIds: ids }) : [];
  if (dups.length > 0 && !args.duplicateOk) {
    const d = dups[0]!;
    throw errors.conflict(
      'duplicate_card',
      `カードの番号「${cardRef}」は、${d.householdName}(${d.memberNo})で${DATE(d.at)}に引き継ぎ済みです。` +
        '同じカードは、1つのおうちでしか引き継げません。カードを見比べて、別のカードだと確かめられたときだけ、印を付けて引き継いでください。',
      { matches: dups },
    );
  }

  const nowIso = toJstIso(now);
  const balance = await pointBalance(db, h.id);
  const plan = planMigration(balance, args.points);
  const cut = cardPoints - args.points;
  const reason =
    `${MIGRATION_SOURCE_LABELS[source]}から引き継ぎ(受付で旧カードを確認)` +
    (cut > 0 ? `。旧カードは${cardPoints}ポイント、上限の${args.points}ポイントまで` : '') +
    (lateReason ? `。移行期間のあと: ${lateReason}` : '');
  const marks = ids.map(() => '?').join(',');
  const opId = `migration:${h.id}:${source}:${nowIso}`;
  const ticketExpiry = expiryFor(settings.ticket_expiry, now);

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
    // 旧カードの使っていない特典は、無料券にする(ポイントは引かない)。元に戻すときは op_id で探す
    ...Array.from({ length: tickets }, () =>
      db
        .prepare(
          `INSERT INTO tickets (household_id, issued_at, expires_at, source, status, note, op_id) VALUES (?, ?, ?, 'migration', 'unused', ?, ?)`,
        )
        .bind(h.id, nowIso, ticketExpiry, `${MIGRATION_SOURCE_LABELS[source]}の特典から`, opId),
    ),
    // 登録経路(11.1)を「移行」にする(はじめて引き継いだとき)
    db.prepare(`UPDATE households SET source = 'migration', updated_at = ? WHERE id = ? AND source = 'new'`).bind(nowIso, h.id),
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
        cardPoints,
        tickets,
        ...(cardRef ? { cardRef } : {}),
        ...(dups.length ? { sameCardMemberNos: dups.map((d) => d.memberNo) } : {}),
        ...(lateReason ? { lateReason } : {}),
        confirmedCard: true,
        collectedCard: true,
      },
      reason,
      undo: { householdId: h.id, source, createdAt: nowIso, requestId: null, opId, householdSource: (await householdSource(db, h.id)) ?? 'new' },
      now,
    }),
    // 操作ログのすぐあとに書き、その行の番号を結びつける
    db
      .prepare(
        `INSERT INTO migration_cards (household_id, source, points, card_points, tickets, card_ref, card_ref_search, note, late_reason,
                                      duplicate_of, staff_id, created_at, audit_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT MAX(id) FROM audit_log))`,
      )
      .bind(
        h.id,
        source,
        args.points,
        cardPoints,
        tickets,
        cardRef,
        cardRefSearch,
        args.note?.trim() || null,
        lateReason,
        dups.length ? JSON.stringify(dups.map((d) => d.memberNo)) : null,
        args.staffId,
        nowIso,
      ),
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
    tickets,
    cardPoints,
    balance: plan.balanceAfter,
  };
}

async function householdSource(db: D1Database, id: number) {
  return (await db.prepare('SELECT source FROM households WHERE id = ?').bind(id).first<{ source: string }>())?.source ?? null;
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
    /** 旧カードの特典から出した無料券の印(tickets.op_id) */
    opId?: string;
    /** 引き継ぐ前の登録経路 */
    householdSource?: string;
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
  const { results: rewards } = info.opId
    ? await db
        .prepare(`SELECT id, status FROM tickets WHERE op_id = ? AND source = 'migration' AND household_id = ?`)
        .bind(info.opId, info.householdId)
        .all<{ id: number; status: string }>()
    : { results: [] as { id: number; status: string }[] };
  if (rewards.some((t) => t.status === 'used')) {
    throw errors.conflict(
      'ticket_already_used',
      '旧カードの特典から出した無料券が、もう使われているため元に戻せません。ポイントと無料券の手動登録で調整してください。',
    );
  }
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
    // 特典から出した無料券を回収する(使っていないものだけ。使われていれば上で止めている)
    ...rewards.map((t) =>
      db
        .prepare(`UPDATE tickets SET status = 'void', note = ? WHERE id = ? AND status <> 'void' AND ${notYet}`)
        .bind('旧カードの引き継ぎを元に戻したため回収', t.id, row.id),
    ),
    db
      .prepare(
        `UPDATE migration_cards SET undone_at = ?, undone_by_staff_id = ? WHERE audit_id = ? AND undone_at IS NULL AND ${notYet}`,
      )
      .bind(nowIso, ctx.staffId, log.id, row.id),
    db
      .prepare(
        `INSERT INTO point_ledger (household_id, delta, kind, migration_source, reason, actor_type, actor_id, created_at, reverses_id)
         SELECT ?, ?, 'migration', ?, ?, 'staff', ?, ?, ? WHERE ${notYet}`,
      )
      .bind(info.householdId, -row.delta, info.source, reason, ctx.staffId, nowIso, row.id, row.id),
  ];
  // 登録経路を引き継ぐ前に戻す(ほかの移行元の引き継ぎが残っていれば「移行」のまま)
  if (info.householdSource === 'new') {
    s.push(
      db
        .prepare(
          `UPDATE households SET source = 'new', updated_at = ? WHERE id = ? AND source = 'migration'
             AND NOT EXISTS (SELECT 1 FROM point_ledger WHERE household_id = ? AND ${ACTIVE_MIGRATION} AND id <> ?)`,
        )
        .bind(nowIso, info.householdId, info.householdId, row.id),
    );
  }
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
      before: { migratedPoints: row.delta, ticketsVoided: [...issued.map((t) => t.ticket_id), ...rewards.map((t) => t.id)] },
      after: { migratedPoints: 0 },
      reason,
      now: ctx.now,
    }),
  );
  await db.batch(s);
}
