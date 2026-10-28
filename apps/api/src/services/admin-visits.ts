import type { AdminVisit, StaffRole } from '@dr/shared';

/** 管理画面向けの写真の URL の頭(ログインのセッションで認証) */
export const ADMIN_MEDIA_BASE = '/admin/api/media';

/** アンケートの個別の回答と、確認待ちの一覧を見られる役割(3.2) */
export const canSeePersonal = (role: StaffRole) => role === 'admin' || role === 'developer';

type VisitRow = {
  id: number;
  visit_date: string;
  checked_in_at: string;
  household_id: number | null;
  member_no: string | null;
  display_name: string | null;
  dog_count: number;
  used_ticket: number;
  method: AdminVisit['method'];
  cancelled_at: string | null;
  cancel_reason: string | null;
  checked_in_by: string | null;
};

/** 指定した日の来場の一覧(取り消し済みも含める。新しい順) */
export async function listVisitsOn(db: D1Database, date: string, role: StaffRole): Promise<AdminVisit[]> {
  const { results } = await db
    .prepare(
      `SELECT v.id, v.visit_date, v.checked_in_at, v.household_id, h.member_no, h.display_name, v.dog_count,
              v.used_ticket, v.method, v.cancelled_at, v.cancel_reason, m.line_display_name AS checked_in_by
         FROM visits v
         LEFT JOIN households h ON h.id = v.household_id
         LEFT JOIN family_members m ON m.id = v.checked_in_member_id
        WHERE v.visit_date = ?
        ORDER BY v.checked_in_at DESC, v.id DESC`,
    )
    .bind(date)
    .all<VisitRow>();
  if (results.length === 0) return [];

  const { results: dogRows } = await db
    .prepare(
      `SELECT vd.visit_id, d.id, d.name, COALESCE(d.breed_other, b.name) AS breed_name, d.thumb_key
         FROM visit_dogs vd JOIN dogs d ON d.id = vd.dog_id JOIN breeds b ON b.id = d.breed_id
        WHERE vd.visit_date = ? ORDER BY vd.id`,
    )
    .bind(date)
    .all<{ visit_id: number; id: number; name: string; breed_name: string; thumb_key: string | null }>();
  const dogsByVisit = new Map<number, AdminVisit['dogs']>();
  for (const d of dogRows) {
    const list = dogsByVisit.get(d.visit_id) ?? [];
    list.push({
      id: d.id,
      name: d.name,
      breedName: d.breed_name,
      thumbUrl: d.thumb_key ? `${ADMIN_MEDIA_BASE}/${d.thumb_key}` : null,
    });
    dogsByVisit.set(d.visit_id, list);
  }

  void role;
  return results.map((v) => ({
    id: v.id,
    date: v.visit_date,
    time: v.checked_in_at.slice(11, 16),
    householdId: v.household_id,
    memberNo: v.member_no,
    householdName: v.display_name,
    dogs: dogsByVisit.get(v.id) ?? [],
    dogCount: v.dog_count,
    usedTicket: v.used_ticket === 1,
    method: v.method,
    cancelled: v.cancelled_at !== null,
    cancelReason: v.cancel_reason,
    checkedInBy: v.checked_in_by,
  }));
}

export function totalsOf(visits: AdminVisit[]) {
  const live = visits.filter((v) => !v.cancelled);
  return {
    groups: live.length,
    memberDogs: live.filter((v) => v.method !== 'walkin').reduce((s, v) => s + v.dogCount, 0),
    walkinDogs: live.filter((v) => v.method === 'walkin').reduce((s, v) => s + v.dogCount, 0),
    ticketsUsed: live.filter((v) => v.usedTicket).length,
  };
}
