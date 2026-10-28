// 日付と日時は、すべて日本時間(Asia/Tokyo、UTC+9。夏時間なし)で扱う。
// 日時は "2026-10-28T09:15:00+09:00" の形の文字列、日付は "2026-10-28" の形の文字列で保存する。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Date を日本時間の日時文字列にする(例: 2026-10-28T09:15:00+09:00)。 */
export function toJstIso(date: Date): string {
  const j = new Date(date.getTime() + JST_OFFSET_MS);
  return (
    `${j.getUTCFullYear()}-${pad(j.getUTCMonth() + 1)}-${pad(j.getUTCDate())}` +
    `T${pad(j.getUTCHours())}:${pad(j.getUTCMinutes())}:${pad(j.getUTCSeconds())}+09:00`
  );
}

/** Date が日本時間で何日かを返す(例: 2026-10-28)。 */
export function toJstDate(date: Date): string {
  return toJstIso(date).slice(0, 10);
}

/** 日本時間の日付に日数を足す。 */
export function addDays(jstDate: string, days: number): string {
  const [y, m, d] = jstDate.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000;
  const r = new Date(t);
  return `${r.getUTCFullYear()}-${pad(r.getUTCMonth() + 1)}-${pad(r.getUTCDate())}`;
}

/** 日本時間の日付の曜日(0=日曜 … 6=土曜)。 */
export function weekdayOf(jstDate: string): number {
  const [y, m, d] = jstDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 日時文字列から「09:15」の形の時刻を取り出す。 */
export function jstTimeOf(iso: string): string {
  return toJstIso(new Date(iso)).slice(11, 16);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}
