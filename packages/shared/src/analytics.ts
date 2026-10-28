import type { Bar, CohortRow, RepeatMonth } from './api-types-analytics';
import type { DayType } from './constants';
import { addDays, weekdayOf } from './date';

// 分析と自動処理のロジック(要件定義書 9.5、13章)。API と画面で共有し、単体テストで確かめる。

/**
 * 日付の曜日区分(calendar.day_type)。
 * 祝日が平日(月〜金)に当たるときは「祝日」。土曜・日曜に当たる祝日は、土曜・日曜のままにする
 * (来場の傾向は土日と同じため。祝日名は calendar.holiday_name に残る)。
 */
export function dayTypeOf(date: string, holidayName: string | null): DayType {
  const w = weekdayOf(date);
  if (w === 0) return 'sunday';
  if (w === 6) return 'saturday';
  return holidayName ? 'holiday' : 'weekday';
}

/** 天気の3つの区分(13章「天気の影響」) */
export const WEATHER_KINDS = ['晴れ', '曇り', '雨'] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];

/** 雨の日とする1日の降水量(mm)。気象庁の「雨日」(日降水量 1.0mm 以上)に合わせる */
export const RAIN_MM = 1.0;
/** 晴れの日とする日照時間(時間)。昼の長さ(東京で約10〜14.5時間)のおよそ4割 */
export const SUNNY_HOURS = 4.0;

/**
 * 1日の降水量と日照時間から、天気(晴れ・曇り・雨)を決める(B-01)。
 * - 降水量が 1.0mm 以上 → 雨
 * - そうでなく、日照時間が 4時間以上 → 晴れ
 * - それ以外 → 曇り
 * 降水量が分からない日、雨でなく日照時間も分からない日は null(天気の分析に入れない)。
 */
export function classifyWeather(input: { precipitation: number | null; sunshineHours: number | null }): WeatherKind | null {
  const { precipitation, sunshineHours } = input;
  if (precipitation === null || Number.isNaN(precipitation)) return null;
  if (precipitation >= RAIN_MM) return '雨';
  if (sunshineHours === null || Number.isNaN(sunshineHours)) return null;
  return sunshineHours >= SUNNY_HOURS ? '晴れ' : '曇り';
}

/**
 * 日付に月数を足す(日にちは同じ。その月にない日は月末にする)。
 * 例: 2026-01-31 + 1か月 = 2026-02-28。ポイントの有効期限(expiryFor)と同じ数え方。
 */
export function addMonthsToDate(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${ty}-${String(tm).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

/**
 * 「最後に来場した日から○か月」の有効期限が切れているか(B-05)。
 * 期限の日(最後の来場日 + ○か月)までは使え、その翌日から失効する。
 */
export function isExpiredSinceLastVisit(lastDate: string, months: number, today: string): boolean {
  return addMonthsToDate(lastDate, months) < today;
}

// ---------------------------------------------------------------------------
// ダッシュボード(A-01、13章)の、おうち単位の指標。
// 入力は「おうちごとの来場日の一覧」(取り消しと臨時休業日を除き、古い順)。visits の household_id と visit_date だけから作る。
// ---------------------------------------------------------------------------

/** おうちID → 来場日(古い順) */
export type HouseholdVisits = Map<number, string[]>;

/** [household_id, visit_date] の行(household_id・visit_date の順に並んでいること)から、おうちごとの来場日の一覧を作る */
export function groupVisits(rows: Iterable<readonly [number, string]>, exclude?: Set<string>): HouseholdVisits {
  const out: HouseholdVisits = new Map();
  for (const [h, d] of rows) {
    if (exclude?.has(d)) continue;
    const list = out.get(h);
    if (list) {
      if (list[list.length - 1] !== d) list.push(d);
    } else out.set(h, [d]);
  }
  for (const list of out.values()) list.sort();
  return out;
}

/** 2つの日付の差(日)。b - a */
export function daysBetween(a: string, b: string): number {
  const t = (s: string) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(b) - t(a)) / 86_400_000);
}

export const monthOf = (date: string) => date.slice(0, 7);

/** "2026-10" の k か月後 */
export function addMonthsToMonth(month: string, k: number): string {
  return addMonthsToDate(`${month}-01`, k).slice(0, 7);
}

/** a から b までの月数(b - a) */
export function monthDiff(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number) as [number, number];
  const [by, bm] = b.split('-').map(Number) as [number, number];
  return (by - ay) * 12 + (bm - am);
}

/** from〜to に含まれる月の一覧 */
export function monthsInRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = monthOf(from); m <= monthOf(to); m = addMonthsToMonth(m, 1)) out.push(m);
  return out;
}

/**
 * リピート率(13章)。期間中に初めて来場したおうちのうち、初回から repeatDays 日以内に2回目の来場があった割合。
 * 初回来場月ごとにも出す。2回目は期間の後(今日まで)でもよい。
 * まだ repeatDays 日たっておらず2回目が来ていないおうちは pending に数える(率の分母には入る)。
 */
export function repeatStats(
  visits: HouseholdVisits,
  opts: { from: string; to: string; today: string; repeatDays: number },
): { months: RepeatMonth[]; firstTimers: number; repeaters: number; pending: number; rate: number | null } {
  const byMonth = new Map<string, RepeatMonth>(
    monthsInRange(opts.from, opts.to).map((m) => [m, { month: m, firstTimers: 0, repeaters: 0, pending: 0, rate: null }]),
  );
  for (const dates of visits.values()) {
    const first = dates[0]!;
    if (first < opts.from || first > opts.to) continue;
    const row = byMonth.get(monthOf(first))!;
    row.firstTimers += 1;
    const second = dates[1];
    if (second !== undefined && daysBetween(first, second) <= opts.repeatDays) row.repeaters += 1;
    else if (addDays(first, opts.repeatDays) >= opts.today) row.pending += 1;
  }
  const months = [...byMonth.values()].map((r) => ({ ...r, rate: r.firstTimers ? r.repeaters / r.firstTimers : null }));
  const firstTimers = months.reduce((s, r) => s + r.firstTimers, 0);
  const repeaters = months.reduce((s, r) => s + r.repeaters, 0);
  const pending = months.reduce((s, r) => s + r.pending, 0);
  return { months, firstTimers, repeaters, pending, rate: firstTimers ? repeaters / firstTimers : null };
}

/**
 * おうちの継続状況(コホート表。13章)。期間中に初めて来場したおうちを初回来場月でまとめ、
 * その k か月後(k = 0, 1, …)にも来場したおうちの数を数える。今日より先の月は null。
 */
export function cohortTable(
  visits: HouseholdVisits,
  opts: { from: string; to: string; today: string; maxOffsets?: number },
): { rows: CohortRow[]; offsets: number } {
  const maxOffsets = opts.maxOffsets ?? 12;
  const months = monthsInRange(opts.from, opts.to);
  const todayMonth = monthOf(opts.today);
  const offsets = Math.max(1, Math.min(maxOffsets, monthDiff(months[0]!, todayMonth) + 1));
  const rows = new Map<string, CohortRow>(
    months.map((m) => [
      m,
      { month: m, size: 0, active: Array.from({ length: offsets }, (_, k) => (addMonthsToMonth(m, k) <= todayMonth ? 0 : null)) },
    ]),
  );
  for (const dates of visits.values()) {
    const first = dates[0]!;
    if (first < opts.from || first > opts.to) continue;
    const row = rows.get(monthOf(first))!;
    row.size += 1;
    const seen = new Set<number>();
    for (const d of dates) {
      const k = monthDiff(row.month, monthOf(d));
      if (k >= 0 && k < offsets && !seen.has(k) && row.active[k] !== null) {
        seen.add(k);
        row.active[k] = (row.active[k] as number) + 1;
      }
    }
  }
  return { rows: [...rows.values()], offsets };
}

export const FREQUENCY_BUCKETS = [
  { label: '1回', min: 1, max: 1 },
  { label: '2〜3回', min: 2, max: 3 },
  { label: '4〜9回', min: 4, max: 9 },
  { label: '10回以上', min: 10, max: Infinity },
] as const;

/** 来場頻度の分布(13章)。期間中の来場回数ごとのおうちの数 */
export function frequencyBuckets(visits: HouseholdVisits, opts: { from: string; to: string }): Bar[] {
  const counts = FREQUENCY_BUCKETS.map(() => 0);
  for (const dates of visits.values()) {
    const n = dates.filter((d) => d >= opts.from && d <= opts.to).length;
    if (n === 0) continue;
    const i = FREQUENCY_BUCKETS.findIndex((b) => n >= b.min && n <= b.max);
    counts[i]! += 1;
  }
  return FREQUENCY_BUCKETS.map((b, i) => ({ label: b.label, count: counts[i]! }));
}

/**
 * 休眠している常連(13章)。これまでに minVisits 回以上来場し、最後の来場から dormantDays 日以上たっているおうち。
 * 今日の時点で判定する。来場回数の多い順、同じなら最後の来場が新しい順。
 */
export function findDormant(
  visits: HouseholdVisits,
  opts: { today: string; dormantDays: number; minVisits: number },
): { householdId: number; visits: number; lastVisit: string; daysSince: number }[] {
  const out: { householdId: number; visits: number; lastVisit: string; daysSince: number }[] = [];
  for (const [householdId, dates] of visits) {
    const past = dates.filter((d) => d <= opts.today);
    if (past.length < opts.minVisits) continue;
    const lastVisit = past[past.length - 1]!;
    const daysSince = daysBetween(lastVisit, opts.today);
    if (daysSince >= opts.dormantDays) out.push({ householdId, visits: past.length, lastVisit, daysSince });
  }
  return out.sort((a, b) => b.visits - a.visits || b.lastVisit.localeCompare(a.lastVisit) || a.householdId - b.householdId);
}

export const AGE_BUCKETS = ['1歳未満', '1〜3歳', '4〜6歳', '7〜9歳', '10歳以上', 'わからない'] as const;

/** 犬の年齢の区分。生まれた年月("2020-04")と、数える日から。7歳以上はシニア */
export function ageBucket(birthYm: string | null, asOf: string): (typeof AGE_BUCKETS)[number] {
  if (!birthYm || !/^\d{4}-\d{2}$/.test(birthYm)) return 'わからない';
  const months = monthDiff(birthYm, monthOf(asOf));
  if (months < 0) return 'わからない';
  const years = Math.floor(months / 12);
  if (years < 1) return '1歳未満';
  if (years <= 3) return '1〜3歳';
  if (years <= 6) return '4〜6歳';
  if (years <= 9) return '7〜9歳';
  return '10歳以上';
}

/** 値を数えて横棒にする。order の順に並べ、order にない値は多い順に後ろへ、空は「未回答」として最後に */
export function countBars(values: (string | null | undefined)[], order: readonly string[] = [], emptyLabel = '未回答'): Bar[] {
  const counts = new Map<string, number>();
  let empty = 0;
  for (const v of values) {
    if (v === null || v === undefined || v === '') empty += 1;
    else counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const bars: Bar[] = order.map((label) => ({ label, count: counts.get(label) ?? 0 }));
  const rest = [...counts.entries()].filter(([k]) => !order.includes(k)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [label, count] of rest) bars.push({ label, count });
  if (empty > 0) bars.push({ label: emptyLabel, count: empty });
  return bars;
}

/** 平均(数がなければ null)。小数1桁 */
export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((s, n) => s + n, 0) / values.length) * 10) / 10;
}
