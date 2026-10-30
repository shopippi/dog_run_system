import {
  MIGRATION_SOURCES,
  MIGRATION_SOURCE_LABELS,
  migrationDaysLeft,
  migrationPhase,
  normalizeCardRef,
  normalizeForSearch,
  toJstDate,
  type MigrationListResponse,
  type MigrationRecord,
  type MigrationSource,
  type MigrationSummary,
} from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { loadSettings } from '../../lib/settings';
import { requireRole } from '../../lib/staff-auth';
import { registerAuditDetail } from '../../services/audit-view';
import { ACTIVE_MIGRATION } from '../../services/migration';

// A-05 旧カードの引き継ぎ(対面だけ)。引き継ぎ済みの一覧(いつ・誰が・どのおうち・何ポイント)と、移行期間のまとめ
// 直接入力(POST /admin/api/households/:id/migrate)と状態(GET /admin/api/households/:id/migration)は routes/admin/requests.ts にある
export const migrationRoutes = new Hono<AppEnv>();

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// 引き継ぎ済みの一覧。q で会員ID・おうちの呼び名・カードの番号から探す
migrationRoutes.get('/migrations', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const raw = (c.req.query('q') ?? '').slice(0, 50).trim();
  const name = raw ? normalizeForSearch(raw) : '';
  const ref = raw ? normalizeCardRef(raw) : null;
  const filter = raw
    ? `AND (h.display_name_search LIKE ?1 ESCAPE '\\' OR lower(h.member_no) LIKE ?1 ESCAPE '\\'
            ${ref ? `OR mc.card_ref_search LIKE ?2 ESCAPE '\\'` : ''})`
    : '';
  const { results } = await db
    .prepare(
      `SELECT a.id, a.created_at, a.target_id, a.after_value, a.undone_at, s.name AS staff_name, u.name AS undone_by,
              h.id AS household_id, h.member_no, h.display_name,
              mc.card_points, mc.tickets, mc.card_ref, mc.card_ref_search, mc.note, mc.late_reason, f.line_display_name AS member_name
         FROM audit_log a
         LEFT JOIN staff_users s ON a.actor_type = 'staff' AND s.id = a.actor_id
         LEFT JOIN staff_users u ON u.id = a.undone_by_staff_id
         JOIN households h ON h.id = CAST(a.target_id AS INTEGER)
         LEFT JOIN migration_cards mc ON mc.audit_id = a.id
         LEFT JOIN family_members f ON f.id = mc.family_member_id
        WHERE a.action = 'household.migrate' ${filter}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 200`,
    )
    .bind(...(raw ? [`%${escapeLike(name || raw.toLowerCase())}%`, ...(ref ? [`%${escapeLike(ref)}%`] : [])] : []))
    .all<{
      id: number;
      created_at: string;
      target_id: string;
      after_value: string | null;
      undone_at: string | null;
      staff_name: string | null;
      undone_by: string | null;
      household_id: number;
      member_no: string;
      display_name: string;
      card_points: number | null;
      tickets: number | null;
      card_ref: string | null;
      card_ref_search: string | null;
      note: string | null;
      late_reason: string | null;
      member_name: string | null;
    }>();

  // 同じカードの番号で引き継いだ、ほかのおうち(元に戻したものは除く)
  const refs = [...new Set(results.map((r) => r.card_ref_search).filter((x): x is string => !!x))];
  const sameCard: { card_ref_search: string; source: MigrationSource; household_id: number; member_no: string; audit_id: number | null }[] = [];
  for (let i = 0; i < refs.length; i += 80) {
    const chunk = refs.slice(i, i + 80);
    const { results: rows } = await db
      .prepare(
        `SELECT c.card_ref_search, c.source, c.household_id, h.member_no, c.audit_id FROM migration_cards c JOIN households h ON h.id = c.household_id
          WHERE c.undone_at IS NULL AND c.card_ref_search IN (${chunk.map(() => '?').join(',')})`,
      )
      .bind(...chunk)
      .all<(typeof sameCard)[number]>();
    sameCard.push(...rows);
  }

  const records: MigrationRecord[] = [];
  for (const r of results) {
    let after: { source?: unknown; migratedPoints?: unknown } = {};
    try {
      after = JSON.parse(r.after_value ?? '{}');
    } catch {
      // 読めない記録は飛ばす
    }
    const source = MIGRATION_SOURCES.find((x) => x === after.source) as MigrationSource | undefined;
    if (!source) continue;
    const points = Number(after.migratedPoints) || 0;
    records.push({
      auditId: r.id,
      at: r.created_at,
      staffName: r.staff_name,
      householdId: r.household_id,
      memberNo: r.member_no,
      householdName: r.display_name,
      memberName: r.member_name,
      source,
      points,
      cardPoints: r.card_points ?? points,
      tickets: r.tickets ?? 0,
      cardRef: r.card_ref,
      note: r.note,
      lateReason: r.late_reason,
      sameCardMemberNos: r.card_ref_search
        ? [
            ...new Set(
              sameCard
                .filter((x) => x.card_ref_search === r.card_ref_search && x.source === source && x.audit_id !== r.id)
                .map((x) => x.member_no),
            ),
          ]
        : [],
      undone: r.undone_at ? { at: r.undone_at, byName: r.undone_by } : null,
    });
  }
  const body: MigrationListResponse = { records, maxPoints: (await loadSettings(db)).migration_max_points };
  return c.json(body);
});

// 移行期間のまとめ(16.2)。引き継いだおうちの数・ポイントの合計・終わりまでの日数
migrationRoutes.get('/migrations/summary', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const settings = await loadSettings(db);
  const today = toJstDate(c.get('now'));
  const [ledger, cards, merged, active, groups] = await db.batch([
    db.prepare(`SELECT household_id, migration_source AS source, delta FROM point_ledger WHERE ${ACTIVE_MIGRATION}`),
    db.prepare(`SELECT points, card_points, tickets FROM migration_cards WHERE undone_at IS NULL`),
    db.prepare(`SELECT id, merged_into_id FROM households WHERE status = 'merged' AND merged_into_id IS NOT NULL`),
    db.prepare(`SELECT COUNT(*) AS n FROM households WHERE status = 'active'`),
    db.prepare(
      `SELECT COUNT(*) AS n FROM (SELECT 1 FROM migration_cards WHERE undone_at IS NULL AND card_ref_search IS NOT NULL
         GROUP BY card_ref_search, source HAVING COUNT(*) > 1)`,
    ),
  ]);
  const into = new Map((merged!.results as { id: number; merged_into_id: number }[]).map((r) => [r.id, r.merged_into_id]));
  const resolve = (id: number) => {
    let cur = id;
    for (let i = 0; i < 20 && into.has(cur); i++) cur = into.get(cur)!;
    return cur;
  };
  const rows = ledger!.results as { household_id: number; source: MigrationSource; delta: number }[];
  const bySource = Object.fromEntries(MIGRATION_SOURCES.map((s) => [s, { count: 0, points: 0 }])) as MigrationSummary['bySource'];
  for (const r of rows) {
    const b = bySource[r.source];
    if (!b) continue;
    b.count += 1;
    b.points += r.delta;
  }
  const cardRows = cards!.results as { points: number; card_points: number | null; tickets: number }[];
  const cappedRows = cardRows.filter((r) => r.card_points !== null && r.card_points > r.points);
  const body: MigrationSummary = {
    period: settings.migration_period,
    phase: migrationPhase(settings.migration_period, today),
    daysLeft: migrationDaysLeft(settings.migration_period, today),
    households: new Set(rows.map((r) => resolve(r.household_id))).size,
    activeHouseholds: (active!.results[0] as { n: number }).n,
    points: rows.reduce((n, r) => n + r.delta, 0),
    tickets: cardRows.reduce((n, r) => n + r.tickets, 0),
    capped: { count: cappedRows.length, points: cappedRows.reduce((n, r) => n + (r.card_points! - r.points), 0) },
    bySource,
    sameCardGroups: (groups!.results[0] as { n: number }).n,
  };
  return c.json(body);
});

registerAuditDetail('household.migrate', (_b, a) => {
  if (!a?.source) return null;
  const label = MIGRATION_SOURCE_LABELS[a.source as MigrationSource] ?? '旧カード';
  const tickets = Number(a.tickets) || 0;
  const card = Number(a.cardPoints);
  const points = Number(a.migratedPoints) || 0;
  const who = typeof a.memberName === 'string' && a.memberName ? `${a.memberName}さんの` : '';
  return (
    `${who}${label}から${points}ポイント` +
    (Number.isFinite(card) && card > points ? `(旧カードは${card}ポイント)` : '') +
    (tickets > 0 ? `・無料券${tickets}枚` : '')
  );
});
