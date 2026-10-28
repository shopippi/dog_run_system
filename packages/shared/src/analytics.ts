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
