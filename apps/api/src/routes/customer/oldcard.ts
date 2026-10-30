import { isWithinMigrationPeriod, toJstDate, toJstIso, type MigrationSource, type OldCardResponse } from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { loadSettings } from '../../lib/settings';
import { historyHouseholdIds } from '../../services/merges';
import { requireMember } from '../../services/members';
import { ACTIVE_MIGRATION } from '../../services/migration';

// 前のカード(旧カード)からの引き継ぎの、お客さんへの案内と記録(16章)。
// お客さんからの申請はない(C-10 はやめた)。案内は「受付で前のカードを見せてください」と伝えるだけ。
export const oldCardRoutes = new Hono<AppEnv>();

/**
 * 会員証の案内と、引き継いだ記録(GET /api/me/oldcard)。
 * 案内は、移行期間の中(期間が未設定なら出す)で、おうちがまだどの旧カードも引き継いでおらず、この家族が閉じていないときだけ出す。
 */
oldCardRoutes.get('/me/oldcard', async (c) => {
  const db = c.env.DB;
  const member = await requireMember(db, c.get('lineUser').userId);
  const settings = await loadSettings(db);
  const ids = await historyHouseholdIds(db, member.householdId);
  const marks = ids.map(() => '?').join(',');
  const [ledger, cards, closed] = await db.batch([
    db
      .prepare(
        `SELECT household_id, migration_source AS source, delta, created_at FROM point_ledger
          WHERE household_id IN (${marks}) AND ${ACTIVE_MIGRATION} ORDER BY created_at DESC, id DESC`,
      )
      .bind(...ids),
    db
      .prepare(`SELECT household_id, source, created_at, tickets FROM migration_cards WHERE household_id IN (${marks}) AND undone_at IS NULL`)
      .bind(...ids),
    db.prepare('SELECT oldcard_notice_closed_at AS at FROM family_members WHERE id = ?').bind(member.memberId),
  ]);
  type L = { household_id: number; source: MigrationSource; delta: number; created_at: string };
  type C = { household_id: number; source: MigrationSource; created_at: string; tickets: number };
  const cardRows = cards!.results as C[];
  const transfers = (ledger!.results as L[]).map((r) => ({
    source: r.source,
    points: r.delta,
    tickets: cardRows.find((x) => x.household_id === r.household_id && x.source === r.source && x.created_at === r.created_at)?.tickets ?? 0,
    at: r.created_at,
  }));
  const closedAt = (closed!.results[0] as { at: string | null } | undefined)?.at ?? null;
  const show = transfers.length === 0 && !closedAt && isWithinMigrationPeriod(settings.migration_period, toJstDate(c.get('now')));
  const body: OldCardResponse = { notice: show ? { endDate: settings.migration_period.end } : null, transfers };
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
