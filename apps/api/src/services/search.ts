import { normalizeForSearch, type HouseholdHit, type StaffRole } from '@dr/shared';
import { ADMIN_MEDIA_BASE } from './admin-visits';

const LIMIT = 60;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

type Row = {
  id: number;
  member_no: string;
  display_name: string;
  status: HouseholdHit['status'];
  merged_into: string | null;
  last_visit: string | null;
};

const SELECT = `
  SELECT h.id, h.member_no, h.display_name, h.status, m.member_no AS merged_into,
         (SELECT MAX(v.visit_date) FROM visits v WHERE v.household_id = h.id AND v.cancelled_at IS NULL) AS last_visit
    FROM households h LEFT JOIN households m ON m.id = h.merged_into_id`;

/**
 * おうちを探す(S-06)。犬の名前・おうちの呼び名・会員ID で探す。
 * 家族の LINE の表示名でも探せる。ひらがなとカタカナ、全角と半角は区別しない(6.3)。
 */
export async function searchHouseholds(db: D1Database, query: string, role: StaffRole): Promise<HouseholdHit[]> {
  const q = normalizeForSearch(query);
  if (!q) return [];
  const like = `%${escapeLike(q)}%`;
  const byLineName = `UNION SELECT household_id FROM family_members
        WHERE status = 'active' AND line_display_name_search LIKE ?1 ESCAPE '\\'`;
  const { results } = await db
    .prepare(
      `${SELECT}
        WHERE h.id IN (
          SELECT household_id FROM dogs WHERE status <> 'merged' AND name_search LIKE ?1 ESCAPE '\\'
          UNION SELECT id FROM households WHERE display_name_search LIKE ?1 ESCAPE '\\' OR lower(member_no) LIKE ?1 ESCAPE '\\'
          ${byLineName}
        )
        ORDER BY h.status = 'active' DESC, last_visit IS NULL, last_visit DESC, h.id DESC
        LIMIT ${LIMIT}`,
    )
    .bind(like)
    .all<Row>();
  return attach(db, results, role);
}

/** 写真で探す(6.3)。最近来たおうちを、来た順に並べる */
export async function recentHouseholds(db: D1Database, role: StaffRole): Promise<HouseholdHit[]> {
  const { results } = await db
    .prepare(
      `${SELECT}
        WHERE h.status = 'active' AND h.id IN (
          SELECT household_id FROM visits
           WHERE household_id IS NOT NULL AND cancelled_at IS NULL
           GROUP BY household_id ORDER BY MAX(checked_in_at) DESC LIMIT ${LIMIT}
        )
        ORDER BY last_visit DESC, h.id DESC`,
    )
    .all<Row>();
  return attach(db, results, role);
}

async function attach(db: D1Database, rows: Row[], role: StaffRole): Promise<HouseholdHit[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const { results: dogs } = await db
    .prepare(
      `SELECT d.household_id, d.id, d.name, COALESCE(d.breed_other, b.name) AS breed_name, d.thumb_key
         FROM dogs d JOIN breeds b ON b.id = d.breed_id
        WHERE d.household_id IN (SELECT value FROM json_each(?)) AND d.status = 'active' ORDER BY d.id`,
    )
    .bind(JSON.stringify(ids))
    .all<{ household_id: number; id: number; name: string; breed_name: string; thumb_key: string | null }>();
  void role;
  const { results: family } = await db
    .prepare(
      `SELECT household_id, line_display_name FROM family_members
        WHERE household_id IN (SELECT value FROM json_each(?)) AND status = 'active' ORDER BY id`,
    )
    .bind(JSON.stringify(ids))
    .all<{ household_id: number; line_display_name: string | null }>();
  return rows.map((r) => ({
    id: r.id,
    memberNo: r.member_no,
    displayName: r.display_name,
    status: r.status,
    mergedIntoMemberNo: r.merged_into,
    lastVisit: r.last_visit,
    dogs: dogs
      .filter((d) => d.household_id === r.id)
      .map((d) => ({
        id: d.id,
        name: d.name,
        breedName: d.breed_name,
        thumbUrl: d.thumb_key ? `${ADMIN_MEDIA_BASE}/${d.thumb_key}` : null,
      })),
    familyNames: family.filter((f) => f.household_id === r.id).map((f) => f.line_display_name ?? ''),
  }));
}
