import { VISIT_HISTORY_PAGE_SIZE, jstTimeOf, type HistoryVisit, type VisitHistoryResponse, type VisitMethod } from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { MERGED_HOUSEHOLDS_CTE } from '../../services/merged-households';
import { requireMember } from '../../services/members';
import { ticketUsedOnVisitSql } from '../../services/tickets';
import { MEDIA_BASE } from './media';

// C-07 来場履歴
export const historyRoutes = new Hono<AppEnv>();

type VisitRow = {
  id: number;
  visit_date: string;
  checked_in_at: string;
  checked_in_member_id: number | null;
  checked_in_by: string | null;
  used_ticket: number;
  method: VisitMethod;
  cancelled_at: string | null;
};

/** ページ送りの印。「来場日_来場の番号」。代理で後から入れた来場があっても、日付の新しい順に並べられるように */
const CURSOR = /^(\d{4}-\d{2}-\d{2})_(\d{1,12})$/;

// 来場履歴(C-07)。新しい順に 20 件ずつ。統合でまとめたおうちの来場も含める(5.3)
historyRoutes.get('/me/visits', async (c) => {
  const db = c.env.DB;
  const member = await requireMember(db, c.get('lineUser').userId);
  const before = c.req.query('before');
  let cursor: [string, number] | null = null;
  if (before) {
    const m = CURSOR.exec(before);
    if (!m) throw errors.badRequest('来場履歴の続きを読み込めませんでした。画面を読み込み直してください。');
    cursor = [m[1]!, Number(m[2])];
  }

  const { results: rows } = await db
    .prepare(
      `WITH RECURSIVE ${MERGED_HOUSEHOLDS_CTE}
       SELECT v.id, v.visit_date, v.checked_in_at, v.checked_in_member_id, m.line_display_name AS checked_in_by,
              ${ticketUsedOnVisitSql('v')} AS used_ticket, v.method, v.cancelled_at
         FROM visits v LEFT JOIN family_members m ON m.id = v.checked_in_member_id
        WHERE v.household_id IN (SELECT id FROM hh)
          ${cursor ? 'AND (v.visit_date < ?2 OR (v.visit_date = ?2 AND v.id < ?3))' : ''}
        ORDER BY v.visit_date DESC, v.id DESC
        LIMIT ${VISIT_HISTORY_PAGE_SIZE + 1}`,
    )
    .bind(member.householdId, ...(cursor ?? []))
    .all<VisitRow>();
  const page = rows.slice(0, VISIT_HISTORY_PAGE_SIZE);
  const ids = page.map((r) => r.id);
  const visits: HistoryVisit[] = [];

  if (ids.length > 0) {
    const inList = ids.map(() => '?').join(',');
    const [dogs, points, tickets] = await db.batch([
      // 統合で1頭にまとめた犬は、まとめた後の犬(名前・写真)で見せる
      db
        .prepare(
          `SELECT vd.visit_id, COALESCE(t.id, d.id) AS id, COALESCE(t.name, d.name) AS name,
                  COALESCE(t.breed_other, d.breed_other) AS breed_other, b.name AS breed_name,
                  COALESCE(t.thumb_key, d.thumb_key) AS thumb_key
             FROM visit_dogs vd
             JOIN dogs d ON d.id = vd.dog_id
             LEFT JOIN dogs t ON t.id = d.merged_into_id AND d.status = 'merged'
             JOIN breeds b ON b.id = COALESCE(t.breed_id, d.breed_id)
            WHERE vd.visit_id IN (${inList})
            ORDER BY vd.id`,
        )
        .bind(...ids),
      db
        .prepare(
          `SELECT visit_id, SUM(delta) AS n FROM point_ledger
            WHERE kind = 'visit' AND visit_id IN (${inList}) GROUP BY visit_id`,
        )
        .bind(...ids),
      db
        .prepare(
          `SELECT issued_visit_id AS visit_id, COUNT(*) AS n FROM tickets
            WHERE issued_visit_id IN (${inList}) AND status <> 'void' GROUP BY issued_visit_id`,
        )
        .bind(...ids),
    ]);
    type DogRow = { visit_id: number; id: number; name: string; breed_other: string | null; breed_name: string; thumb_key: string | null };
    const dogsByVisit = new Map<number, HistoryVisit['dogs']>();
    for (const d of dogs!.results as DogRow[]) {
      const list = dogsByVisit.get(d.visit_id) ?? [];
      if (!list.some((x) => x.id === d.id)) {
        list.push({
          id: d.id,
          name: d.name,
          breedName: d.breed_other ?? d.breed_name,
          thumbUrl: d.thumb_key ? `${MEDIA_BASE}/${d.thumb_key}` : null,
        });
      }
      dogsByVisit.set(d.visit_id, list);
    }
    const count = (r: D1Result) => new Map((r.results as { visit_id: number; n: number }[]).map((x) => [x.visit_id, x.n]));
    const pointsBy = count(points!);
    const ticketsBy = count(tickets!);

    for (const r of page) {
      visits.push({
        id: r.id,
        date: r.visit_date,
        time: jstTimeOf(r.checked_in_at),
        dogs: dogsByVisit.get(r.id) ?? [],
        checkedInBy: r.method === 'proxy' ? null : r.checked_in_by || null,
        checkedInByMe: r.checked_in_member_id === member.memberId && r.method !== 'proxy',
        method: r.method,
        pointsAwarded: pointsBy.get(r.id) ?? 0,
        ticketsIssued: ticketsBy.get(r.id) ?? 0,
        usedTicket: r.used_ticket === 1,
        cancelled: r.cancelled_at !== null,
      });
    }
  }

  const last = page.at(-1);
  const body: VisitHistoryResponse = {
    visits,
    next: rows.length > VISIT_HISTORY_PAGE_SIZE && last ? `${last.visit_date}_${last.id}` : null,
  };
  return c.json(body);
});
