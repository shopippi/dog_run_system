import { addDays, dayTypeOf, toJstDate, toJstIso, weekdayOf } from '@dr/shared';
import { errorText, JobError, type JobOutcome } from './jobs';

/** 内閣府の「国民の祝日」の CSV(Shift_JIS)。1955年から翌年までの祝日・休日が載っている */
export const HOLIDAY_CSV_URL = 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv';

/** 取り込む範囲。今年から何年前までか(それより前の日付は分析に使わない) */
const YEARS_BACK = 5;

export type Holiday = { date: string; name: string };

/**
 * CSV を読む。1行目は見出し(国民の祝日・休日月日,国民の祝日・休日名称)、2行目から「2026/1/1,元日」の形。
 * 日付は "2026-01-01" の形にそろえる。読めない行は飛ばす。
 */
export function parseHolidayCsv(text: string): Holiday[] {
  const out: Holiday[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s*,\s*(.+?)\s*$/);
    if (!m) continue;
    const date = `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
    out.push({ date, name: m[4]!.replace(/^"|"$/g, '') });
  }
  return out;
}

/** CSV を取ってきて文字にする(Shift_JIS)。失敗したら、画面に出せる言葉で投げる */
export async function fetchHolidayCsv(): Promise<string> {
  let res: Response;
  try {
    res = await fetch(HOLIDAY_CSV_URL, { headers: { 'user-agent': 'dog-run-system (holiday import)' } });
  } catch (e) {
    throw new JobError('祝日の取得先(内閣府のサイト)につながりませんでした。少し待ってから、もう一度お試しください。', errorText(e));
  }
  if (!res.ok) {
    throw new JobError(
      '祝日の取得先(内閣府のサイト)から祝日を受け取れませんでした。少し待ってから、もう一度お試しください。',
      `応答 ${res.status}`,
    );
  }
  const buf = await res.arrayBuffer();
  return new TextDecoder('shift_jis').decode(buf);
}

/**
 * 祝日を取り込み、calendar の祝日名(holiday_name)と曜日区分(day_type)を更新する(B-02)。
 * - 今年から YEARS_BACK 年前より後の日付だけを取り込む
 * - CSV に載っている範囲で、CSV から消えた祝日(法改正で動いた日など)は、祝日でない日に戻す
 * - 臨時休業(is_closed)はそのまま
 * - 翌年の祝日がまだ載っていないとき(例年2月に公表される)は「一部だけ」(warning)にする
 */
export async function importHolidays(db: D1Database, now: Date, csvText?: string): Promise<JobOutcome> {
  const text = csvText ?? (await fetchHolidayCsv());
  const all = parseHolidayCsv(text);
  if (all.length === 0) {
    throw new JobError('受け取った祝日の一覧を読み取れませんでした。製作者に連絡してください。', '祝日の CSV に読める行がない(形式が変わった可能性)');
  }

  const today = toJstDate(now);
  const thisYear = Number(today.slice(0, 4));
  const from = `${thisYear - YEARS_BACK}-01-01`;
  const holidays = all.filter((h) => h.date >= from);
  const to = holidays.reduce((max, h) => (h.date > max ? h.date : max), from);
  const lastYear = Number(to.slice(0, 4));
  const nowIso = toJstIso(now);
  const rows = holidays.map((h) => ({ d: h.date, w: weekdayOf(h.date), n: h.name, t: dayTypeOf(h.date, h.name) }));

  await db.batch([
    // CSV に載っている範囲で、祝日でなくなった日を戻す
    db
      .prepare(
        `UPDATE calendar
            SET holiday_name = NULL,
                day_type = CASE weekday WHEN 0 THEN 'sunday' WHEN 6 THEN 'saturday' ELSE 'weekday' END,
                updated_at = ?3
          WHERE date BETWEEN ?1 AND ?2 AND holiday_name IS NOT NULL
            AND date NOT IN (SELECT json_extract(value, '$.d') FROM json_each(?4))`,
      )
      .bind(from, `${lastYear}-12-31`, nowIso, JSON.stringify(rows)),
    db
      .prepare(
        `INSERT INTO calendar (date, weekday, holiday_name, day_type, is_closed, updated_at)
         SELECT json_extract(value, '$.d'), json_extract(value, '$.w'), json_extract(value, '$.n'),
                json_extract(value, '$.t'), 0, ?1
           FROM json_each(?2)
          WHERE true
         ON CONFLICT(date) DO UPDATE SET
           holiday_name = excluded.holiday_name,
           day_type = excluded.day_type,
           updated_at = excluded.updated_at`,
      )
      .bind(nowIso, JSON.stringify(rows)),
  ]);

  const nextYear = thisYear + 1;
  const message = `${from.slice(0, 4)}年〜${lastYear}年の祝日を${holidays.length}件取り込みました。`;
  if (lastYear < nextYear) {
    return {
      status: 'warning',
      message: `${message}${nextYear}年の祝日はまだ公表されていませんでした。1週間ごとに取り込み直します。`,
    };
  }
  return { message };
}

/**
 * 毎晩の処理の中で、祝日を取り込むかを決める(B-02)。
 * - 毎年 2月1日(翌年の祝日が公表される時期)
 * - まだ一度も取り込めていないとき・前回が失敗したとき(毎晩やり直す)
 * - 前回、翌年の分がまだ載っていなかったとき(1週間ごとにやり直す)
 */
export async function shouldImportHolidays(db: D1Database, now: Date): Promise<boolean> {
  const today = toJstDate(now);
  if (today.slice(5) === '02-01') return true;
  const last = await db
    .prepare("SELECT status, started_at FROM system_jobs WHERE name = 'holidays' AND status <> 'running' ORDER BY started_at DESC, id DESC LIMIT 1")
    .first<{ status: string; started_at: string }>();
  if (!last || last.status === 'failed') return true;
  if (last.status === 'warning') return last.started_at.slice(0, 10) <= addDays(today, -7);
  // 2月1日に動かなかった年のため、1年以上取り込んでいなければ取り込む
  return last.started_at.slice(0, 10) <= addDays(today, -366);
}
