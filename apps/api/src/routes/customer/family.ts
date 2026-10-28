import { toJstIso, type FamilyResponse, type JoinMethod } from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { requireMember } from '../../services/members';

// C-13 家族の一覧・抜ける
export const familyRoutes = new Hono<AppEnv>();

// おうちの家族(C-13)。いまおうちにいる家族だけ。参加した順
familyRoutes.get('/family', async (c) => {
  const db = c.env.DB;
  const member = await requireMember(db, c.get('lineUser').userId);
  const { results } = await db
    .prepare(
      `SELECT id, line_display_name, joined_at, join_method FROM family_members
        WHERE household_id = ? AND status = 'active' ORDER BY joined_at, id`,
    )
    .bind(member.householdId)
    .all<{ id: number; line_display_name: string | null; joined_at: string; join_method: JoinMethod }>();
  const body: FamilyResponse = {
    members: results.map((r) => ({
      id: r.id,
      name: r.line_display_name || null,
      isMe: r.id === member.memberId,
      joinedAt: r.joined_at,
      joinMethod: r.join_method,
    })),
  };
  return c.json(body);
});

const lastMember = () =>
  errors.conflict(
    'last_member',
    'このおうちに残っている家族があなただけのため、抜けることはできません(この画面から退会はできません)。退会したいときは、受付にお知らせください。',
  );

// 自分がおうちから抜ける(C-13、5.4)。ポイント・来場・犬はおうちに残る。抜けたあとは未登録の扱いになり、新しいおうちとして登録し直せる
familyRoutes.post('/family/leave', async (c) => {
  const db = c.env.DB;
  const member = await requireMember(db, c.get('lineUser').userId);
  const nowIso = toJstIso(c.get('now'));
  // 最後の1人は抜けられない。2人が同時に抜けようとしても、必ず1人は残るよう、書き込みの条件で確かめる
  const stillOthers = `(SELECT COUNT(*) FROM family_members WHERE household_id = ?2 AND status = 'active') > 1`;
  const [update] = await db.batch([
    db
      .prepare(
        `UPDATE family_members SET status = 'left', left_at = ?3, updated_at = ?3
          WHERE id = ?1 AND household_id = ?2 AND status = 'active' AND ${stillOthers}`,
      )
      .bind(member.memberId, member.householdId, nowIso),
    // 操作ログ(お客さん自身の操作として残す)。元に戻すときは、受付の招待で入り直してもらう
    db
      .prepare(
        `INSERT INTO audit_log (actor_type, actor_id, action, target_type, target_id, before_value, after_value, created_at)
         SELECT 'member', ?1, 'family.leave', 'family_member', ?6, ?4, ?5, ?3
          WHERE changes() = 1`,
      )
      .bind(
        member.memberId,
        member.householdId,
        nowIso,
        JSON.stringify({ status: 'active', householdId: member.householdId, memberNo: member.memberNo }),
        JSON.stringify({ status: 'left' }),
        // 対象の ID は整数の文字列にする(数値のまま CAST すると "5.0" になることがある)
        String(Math.trunc(member.memberId)),
      ),
  ]);
  if (update!.meta.changes !== 1) throw lastMember();
  return c.json({ ok: true });
});
