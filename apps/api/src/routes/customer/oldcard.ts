import { isWithinMigrationPeriod, toJstDate, toJstIso, type OldCardResponse } from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { loadSettings } from '../../lib/settings';
import { historyHouseholdIds } from '../../services/merges';
import { requireMember } from '../../services/members';
import { householdCards } from '../../services/migration';

// 前のカード(旧カード)からの引き継ぎの、お客さんへの案内と記録(16章)。
// お客さんからの申請はない(C-10 はやめた)。案内は「受付で前のカードを見せてください」と伝えるだけ。
export const oldCardRoutes = new Hono<AppEnv>();

/**
 * 会員証の案内と、引き継いだ記録(GET /api/me/oldcard)。
 * 案内は家族(LINE アカウント)ごと(2026-10-30 の決定。カード1枚ごとに引き継ぐため):
 * 移行期間の中(期間が未設定なら出す)で、本人のカードをまだ1枚も引き継いでおらず、本人が閉じていないときだけ出す。
 * ほかの家族が引き継いでいても、本人がまだなら出す。記録はおうち全体(だれのカードか・本人のものか)を返す。
 */
oldCardRoutes.get('/me/oldcard', async (c) => {
  const db = c.env.DB;
  const lineUserId = c.get('lineUser').userId;
  const member = await requireMember(db, lineUserId);
  const settings = await loadSettings(db);
  const cards = await householdCards(db, await historyHouseholdIds(db, member.householdId));
  const [closed, own] = await db.batch([
    db.prepare('SELECT oldcard_notice_closed_at AS at FROM family_members WHERE id = ?').bind(member.memberId),
    // 本人(同じ LINE のユーザーが入り直した記録も含む)のカードを、どこかで引き継いだか
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM migration_cards
          WHERE undone_at IS NULL AND family_member_id IN (SELECT id FROM family_members WHERE id = ? OR line_user_id = ?)`,
      )
      .bind(member.memberId, lineUserId),
  ]);
  const closedAt = (closed!.results[0] as { at: string | null } | undefined)?.at ?? null;
  const mineDone = ((own!.results[0] as { n: number } | undefined)?.n ?? 0) > 0;
  const show = !mineDone && !closedAt && isWithinMigrationPeriod(settings.migration_period, toJstDate(c.get('now')));
  const body: OldCardResponse = {
    notice: show ? { endDate: settings.migration_period.end } : null,
    transfers: cards.map((t) => ({
      source: t.source,
      points: t.points,
      tickets: t.tickets,
      at: t.date,
      memberName: t.memberName,
      mine: t.memberId === member.memberId,
    })),
  };
  return c.json(body);
});

// 案内を閉じた(この家族 = LINE アカウントだけ。おうちのほかの家族には出たまま)
oldCardRoutes.post('/me/oldcard/close', async (c) => {
  const db = c.env.DB;
  const member = await requireMember(db, c.get('lineUser').userId);
  await db
    .prepare('UPDATE family_members SET oldcard_notice_closed_at = ? WHERE id = ? AND oldcard_notice_closed_at IS NULL')
    .bind(toJstIso(c.get('now')), member.memberId)
    .run();
  return c.json({ ok: true });
});
