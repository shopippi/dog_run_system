import type { DayType } from './constants';
import { weekdayOf } from './date';

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
