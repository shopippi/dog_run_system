// CSV の書き出し(A-14)。Excel でそのまま開けるよう、UTF-8 の BOM をつけ、改行は CRLF にする。

export type CsvValue = string | number | null | undefined;

/** 1つの値を CSV の形にする。式として読まれないよう、= + - @ で始まる文字(数を除く)の前に ' を付ける */
export function csvCell(v: CsvValue): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: CsvValue[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
