import { MIGRATION_SOURCES, MIGRATION_SOURCE_LABELS, type MigrationListResponse, type MigrationRecord, type MigrationSource } from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { loadSettings } from '../../lib/settings';
import { requireRole } from '../../lib/staff-auth';
import { registerAuditDetail } from '../../services/audit-view';

// A-05 旧カードの引き継ぎ(対面だけ)。引き継ぎ済みの一覧(いつ・誰が・どのおうち・何ポイント)
// 直接入力(POST /admin/api/households/:id/migrate)と状態(GET /admin/api/households/:id/migration)は routes/admin/requests.ts にある
export const migrationRoutes = new Hono<AppEnv>();

migrationRoutes.get('/migrations', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const { results } = await db
    .prepare(
      `SELECT a.id, a.created_at, a.target_id, a.after_value, a.undone_at, s.name AS staff_name, u.name AS undone_by,
              h.id AS household_id, h.member_no, h.display_name
         FROM audit_log a
         LEFT JOIN staff_users s ON a.actor_type = 'staff' AND s.id = a.actor_id
         LEFT JOIN staff_users u ON u.id = a.undone_by_staff_id
         JOIN households h ON h.id = CAST(a.target_id AS INTEGER)
        WHERE a.action = 'household.migrate'
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 200`,
    )
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
    }>();
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
    records.push({
      auditId: r.id,
      at: r.created_at,
      staffName: r.staff_name,
      householdId: r.household_id,
      memberNo: r.member_no,
      householdName: r.display_name,
      source,
      points: Number(after.migratedPoints) || 0,
      undone: r.undone_at ? { at: r.undone_at, byName: r.undone_by } : null,
    });
  }
  const body: MigrationListResponse = { records, maxPoints: (await loadSettings(db)).migration_max_points };
  return c.json(body);
});

registerAuditDetail('household.migrate', (_b, a) => {
  if (!a?.source) return null;
  const label = MIGRATION_SOURCE_LABELS[a.source as MigrationSource] ?? '旧カード';
  return `${label}から${a.migratedPoints ?? 0}ポイント`;
});
