import { toJstIso } from '@dr/shared';

/**
 * calendar テーブルに、from〜to の日付の行がなければ作る(曜日と曜日区分)。
 * すでにある行(祝日の取り込みや臨時休業の登録で作られた行)は変えない。
 * 1つの SQL で作るので、400日分でもデータベースへの問い合わせは1回。
 */
export function ensureCalendarStatement(db: D1Database, from: string, to: string, now: Date): D1PreparedStatement {
  return db
    .prepare(
      `WITH RECURSIVE d(date) AS (
         SELECT ?1 UNION ALL SELECT date(date, '+1 day') FROM d WHERE date < ?2
       )
       INSERT OR IGNORE INTO calendar (date, weekday, holiday_name, day_type, is_closed, updated_at)
       SELECT date, CAST(strftime('%w', date) AS INTEGER), NULL,
              CASE strftime('%w', date) WHEN '0' THEN 'sunday' WHEN '6' THEN 'saturday' ELSE 'weekday' END,
              0, ?3
         FROM d`,
    )
    .bind(from, to, toJstIso(now));
}
