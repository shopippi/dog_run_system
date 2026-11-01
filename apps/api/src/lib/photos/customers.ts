import { toJstIso } from '@dr/shared';
import type { LineUser } from '../../env';

// 写真の購入者(photo_customers)。LINE アカウントごとに1行(docs/photo-requirements.md 5章)。
// 会員でない LINE ユーザーも買える。会員なら、いまの家族ID・おうちを記録だけする(購入の権利は購入者ごと。家族で共有しない)。

export type PhotoCustomer = { id: number; householdId: number | null; familyMemberId: number | null; displayName: string | null };

/**
 * ログイン中の LINE ユーザーの購入者を返す(なければ作る)。表示名・家族ID・おうちは、来るたびに最新にする。
 * お客さん向けの写真販売の API は、すべてここで購入者を決め、その購入者のものだけを返す
 */
export async function ensurePhotoCustomer(db: D1Database, user: LineUser, now: Date): Promise<PhotoCustomer> {
  const nowIso = toJstIso(now);
  const member = await db
    .prepare("SELECT id, household_id FROM family_members WHERE line_user_id = ? AND status = 'active' LIMIT 1")
    .bind(user.userId)
    .first<{ id: number; household_id: number }>();
  const row = await db
    .prepare(
      `INSERT INTO photo_customers (line_user_id, display_name, family_member_id, household_id, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT (line_user_id) WHERE line_user_id IS NOT NULL DO UPDATE SET
         display_name = excluded.display_name,
         family_member_id = COALESCE(excluded.family_member_id, photo_customers.family_member_id),
         household_id = COALESCE(excluded.household_id, photo_customers.household_id),
         updated_at = CASE WHEN photo_customers.display_name IS excluded.display_name
                            AND photo_customers.family_member_id IS COALESCE(excluded.family_member_id, photo_customers.family_member_id)
                            AND photo_customers.household_id IS COALESCE(excluded.household_id, photo_customers.household_id)
                           THEN photo_customers.updated_at ELSE excluded.updated_at END
       RETURNING id, household_id, family_member_id, display_name`,
    )
    .bind(user.userId, user.displayName || null, member?.id ?? null, member?.household_id ?? null, nowIso)
    .first<{ id: number; household_id: number | null; family_member_id: number | null; display_name: string | null }>();
  if (!row) throw new Error('購入者を記録できませんでした');
  return { id: row.id, householdId: row.household_id, familyMemberId: row.family_member_id, displayName: row.display_name };
}
