import { addDays, toJstDate, toJstIso } from '@dr/shared';
import { ensureCalendarStatement } from './calendar';

/** 毎晩の再計算でさかのぼる日数(B-03) */
export const DAILY_STATS_RECHECK_DAYS = 400;

/**
 * 日別集計(B-03)。from〜to の各日について、来場(visits)などから集計して daily_stats に書く。
 * 要件定義書 13章の定義に合わせる:
 * - 取り消した来場は数えない
 * - 臨時休業日(calendar.is_closed)は、すべての値を 0 にする(すべての指標から除外)
 * - 来場組数と来場頭数は、会員以外の入力も含める(頭数は会員と会員以外に分けて持つ)
 * - 初来場のおうち: その日の来場が、おうちの取り消していない最初の来場であるおうちの数
 * - 新規おうち数: その日に会員IDを発行した(登録した)おうちの数
 *
 * 集計は1つの SQL で行う(来場1件ごとの更新でも、毎晩の400日分でも同じ処理)。
 * 来場がない日も 0 の行を作る(「1日あたりの平均」で営業していた日として数えるため)。
 */
export async function refreshDailyStatsRange(db: D1Database, from: string, to: string, now = new Date()): Promise<void> {
  const nowIso = toJstIso(now);
  await db.batch([
    ensureCalendarStatement(db, from, to, now),
    db
      .prepare(
        `WITH RECURSIVE d(date) AS (
           SELECT ?1 UNION ALL SELECT date(date, '+1 day') FROM d WHERE date < ?2
         ),
         v AS (
           SELECT visit_date AS date,
                  COUNT(*) AS groups,
                  SUM(CASE WHEN household_id IS NOT NULL THEN dog_count ELSE 0 END) AS dogs_member,
                  SUM(CASE WHEN household_id IS NULL THEN dog_count ELSE 0 END) AS dogs_walkin,
                  SUM(used_ticket) AS tickets_used
             FROM visits
            WHERE visit_date BETWEEN ?1 AND ?2 AND cancelled_at IS NULL
            GROUP BY visit_date
         ),
         f AS (
           SELECT v.visit_date AS date, COUNT(*) AS n
             FROM visits v
            WHERE v.visit_date BETWEEN ?1 AND ?2 AND v.household_id IS NOT NULL AND v.cancelled_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM visits p
                 WHERE p.household_id = v.household_id AND p.cancelled_at IS NULL AND p.visit_date < v.visit_date
              )
            GROUP BY v.visit_date
         ),
         n AS (
           SELECT substr(registered_at, 1, 10) AS date, COUNT(*) AS n
             FROM households
            WHERE registered_at >= ?1 AND registered_at < date(?2, '+1 day')
            GROUP BY substr(registered_at, 1, 10)
         )
         INSERT INTO daily_stats (date, visit_groups, dogs_member, dogs_walkin, new_households,
                                  first_visit_households, tickets_used, updated_at)
         SELECT d.date,
                CASE WHEN c.is_closed = 1 THEN 0 ELSE COALESCE(v.groups, 0) END,
                CASE WHEN c.is_closed = 1 THEN 0 ELSE COALESCE(v.dogs_member, 0) END,
                CASE WHEN c.is_closed = 1 THEN 0 ELSE COALESCE(v.dogs_walkin, 0) END,
                CASE WHEN c.is_closed = 1 THEN 0 ELSE COALESCE(n.n, 0) END,
                CASE WHEN c.is_closed = 1 THEN 0 ELSE COALESCE(f.n, 0) END,
                CASE WHEN c.is_closed = 1 THEN 0 ELSE COALESCE(v.tickets_used, 0) END,
                ?3
           FROM d
           LEFT JOIN v ON v.date = d.date
           LEFT JOIN f ON f.date = d.date
           LEFT JOIN n ON n.date = d.date
           LEFT JOIN calendar c ON c.date = d.date
          WHERE true
         ON CONFLICT(date) DO UPDATE SET
           visit_groups = excluded.visit_groups,
           dogs_member = excluded.dogs_member,
           dogs_walkin = excluded.dogs_walkin,
           new_households = excluded.new_households,
           first_visit_households = excluded.first_visit_households,
           tickets_used = excluded.tickets_used,
           updated_at = excluded.updated_at`,
      )
      .bind(from, to, nowIso),
  ]);
}

/** 1日分の日別集計を作り直す(チェックイン・取り消し・犬の追加・会員以外の入力のたびに呼ぶ) */
export async function refreshDailyStats(db: D1Database, date: string, now = new Date()): Promise<void> {
  await refreshDailyStatsRange(db, date, date, now);
}

/**
 * チェックインなどの処理の最後に呼ぶ。集計に失敗しても、チェックインそのものは成功しているので
 * エラーにはしない(毎晩の再計算で直る)。
 */
export async function refreshDailyStatsQuietly(db: D1Database, date: string, now = new Date()): Promise<void> {
  try {
    await refreshDailyStats(db, date, now);
  } catch (e) {
    console.error('[daily-stats]', date, e);
  }
}

/**
 * おうちの統合・統合を元に戻したあとに呼ぶ。そのおうちの最初の来場日(または登録日)から今日までを作り直す
 * (初来場のおうちの数が変わるため)。失敗してもエラーにはしない(毎晩の再計算で直る)。
 */
export async function refreshDailyStatsForHouseholdsQuietly(db: D1Database, householdIds: number[], now = new Date()): Promise<void> {
  try {
    const ids = householdIds.filter((n) => Number.isInteger(n));
    if (ids.length === 0) return;
    const marks = ids.map(() => '?').join(',');
    const row = await db
      .prepare(
        `SELECT MIN(d) AS from_date FROM (
           SELECT MIN(visit_date) AS d FROM visits WHERE household_id IN (${marks})
           UNION ALL SELECT MIN(substr(registered_at, 1, 10)) FROM households WHERE id IN (${marks})
         )`,
      )
      .bind(...ids, ...ids)
      .first<{ from_date: string | null }>();
    const to = toJstDate(now);
    const from = row?.from_date && row.from_date < to ? row.from_date : to;
    await refreshDailyStatsRange(db, from, to, now);
  } catch (e) {
    console.error('[daily-stats]', householdIds, e);
  }
}

/** 毎晩の再計算(B-03)。今日から DAILY_STATS_RECHECK_DAYS 日さかのぼって作り直す */
export async function recheckDailyStats(db: D1Database, now: Date): Promise<{ from: string; to: string }> {
  const to = toJstDate(now);
  const from = addDays(to, -(DAILY_STATS_RECHECK_DAYS - 1));
  await refreshDailyStatsRange(db, from, to, now);
  return { from, to };
}
