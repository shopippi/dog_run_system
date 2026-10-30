// CSV の書き出し(A-14・ダッシュボードのパネルの「CSV」)。API と管理画面で共有する。
// - Excel でそのまま開けるよう、UTF-8 の BOM をつけ、改行は CRLF にする
// - 先頭に「#」で始まる説明行を置ける(docs/design.md 12.2)。AI はそのまま読み、表計算ソフトでは1列目に出るだけ。
//   説明行は1つのセルに収まるよう、半角のカンマと引用符を全角に置き換える(行の先頭がいつも「#」になるように)

export type CsvValue = string | number | null | undefined;

/** 1つの値を CSV の形にする。式として読まれないよう、= + - @ で始まる文字(数を除く)の前に ' を付ける */
export function csvCell(v: CsvValue): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 説明行を1行にする(先頭に「# 」。カンマ・引用符・改行は使わない) */
export function csvCommentLine(text: string): string {
  const body = text.replace(/\r?\n/g, ' ').replace(/,/g, '、').replace(/"/g, '”').trim();
  return body ? `# ${body}` : '#';
}

export function toCsv(header: string[], rows: CsvValue[][], preamble: string[] = []): string {
  const lines = [...preamble.map(csvCommentLine), ...[header, ...rows].map((r) => r.map(csvCell).join(','))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** 列の名前と意味(説明行の「列の意味」に出す) */
export type CsvColumn = { name: string; desc: string };

/**
 * 説明行を作る(docs/design.md 12.2)。
 * 施設名・出力日時・期間・集計の単位 → 列の意味 → 注意 → 使い方の例 の順。
 */
export function csvPreamble(args: {
  title: string;
  facilityName: string;
  /** 出力した日時(日本時間の "2026-10-29T10:00:00+09:00") */
  exportedAt: string;
  /** 期間の文(「2026-10-01〜2026-10-29」「すべての期間」など)。なければ出さない */
  period?: string | null;
  /** 集計の単位(「1日1行」など) */
  unit?: string;
  columns: CsvColumn[];
  notes?: string[];
  usage?: string[];
}): string[] {
  const lines = [
    `${args.facilityName} ${args.title}`,
    `出力した日時: ${args.exportedAt.slice(0, 16).replace('T', ' ')}(日本時間)`,
  ];
  if (args.period) lines.push(`期間: ${args.period}(日付はすべて日本時間)`);
  if (args.unit) lines.push(`集計の単位: ${args.unit}`);
  lines.push('列の意味:');
  for (const c of args.columns) lines.push(`- ${c.name} = ${c.desc}`);
  if (args.notes?.length) {
    lines.push('注意:');
    for (const n of args.notes) lines.push(`- ${n}`);
  }
  if (args.usage?.length) {
    lines.push('使い方の例:');
    for (const u of args.usage) lines.push(`- ${u}`);
  }
  lines.push('(「#」で始まる行は説明です。表は次の行の見出しから始まります)');
  return lines;
}
