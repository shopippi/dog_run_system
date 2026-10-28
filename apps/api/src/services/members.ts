import { normalizeForSearch, toJstIso } from '@dr/shared';
import type { LineUser } from '../env';
import { errors } from '../lib/errors';

export type MemberContext = {
  memberId: number;
  householdId: number;
  memberNo: string;
  householdName: string;
  lineDisplayName: string;
};

/** LINE アカウントが今入っているおうちを探す。入っていなければ null。 */
export async function findActiveMember(db: D1Database, lineUserId: string): Promise<MemberContext | null> {
  const row = await db
    .prepare(
      `SELECT m.id AS memberId, m.household_id AS householdId, h.member_no AS memberNo,
              h.display_name AS householdName, COALESCE(m.line_display_name, '') AS lineDisplayName
         FROM family_members m
         JOIN households h ON h.id = m.household_id
        WHERE m.line_user_id = ? AND m.status = 'active' AND h.status = 'active'`,
    )
    .bind(lineUserId)
    .first<MemberContext>();
  return row ?? null;
}

/** おうちに入っていることが前提の API で使う。入っていなければ「登録がまだ」と返す。 */
export async function requireMember(db: D1Database, lineUserId: string): Promise<MemberContext> {
  const m = await findActiveMember(db, lineUserId);
  if (!m) {
    throw errors.conflict('not_registered', '会員登録がまだ済んでいません。はじめての方の登録から進めてください。');
  }
  return m;
}

/** LINE の表示名が変わっていたら、家族の記録を更新する。 */
export async function refreshDisplayName(db: D1Database, member: MemberContext, lineUser: LineUser, now: Date) {
  if (!lineUser.displayName || lineUser.displayName === member.lineDisplayName) return;
  await db
    .prepare('UPDATE family_members SET line_display_name = ?, line_display_name_search = ?, updated_at = ? WHERE id = ?')
    .bind(lineUser.displayName, normalizeForSearch(lineUser.displayName), toJstIso(now), member.memberId)
    .run();
  member.lineDisplayName = lineUser.displayName;
}

/** 次に使う会員IDの番号。会員IDは再利用しないので、これまでの最大の番号 + 1。 */
export async function nextHouseholdId(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM households').first<{ next: number }>();
  return row?.next ?? 1;
}
