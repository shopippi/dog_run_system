// 日本時間の日時・日付の見せ方(管理画面)。保存されている値はすべて日本時間の文字列。

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** "2026-10-28T10:05:00+09:00" → "2026/10/28 10:05" */
export function formatDateTime(iso: string): string {
  return `${iso.slice(0, 4)}/${iso.slice(5, 7)}/${iso.slice(8, 10)} ${iso.slice(11, 16)}`;
}

/** "2026-10-28" → "2026/10/28" */
export function formatYmd(ymd: string): string {
  return ymd.slice(0, 10).replace(/-/g, '/');
}

/** "2026-10-28" → "10月28日(水)" */
export function formatMonthDay(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number) as [number, number, number];
  return `${m}月${d}日(${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}

/** 生まれた年月 "2020-04" → "2020年4月" */
export function formatYm(ym: string | null): string {
  if (!ym) return '';
  const [y, m] = ym.split('-').map(Number);
  return `${y}年${m}月`;
}
