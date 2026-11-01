import { csvPreamble, toCsv, toJstIso, type CsvColumn, type CsvValue, type Granularity, type SeriesBucket } from '@dr/shared';

// ダッシュボード(M-05)の数・日付の見せ方と、パネルの「CSV」の書き出し

export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const parts = (ymd: string) => ymd.split('-').map(Number) as [number, number, number];
export const weekdayOf = (ymd: string) => {
  const [y, m, d] = parts(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
/** 10月24日 */
export const md = (ymd: string) => {
  const [, m, d] = parts(ymd);
  return `${m}月${d}日`;
};
/** 10月24日(土) */
export const mdw = (ymd: string) => `${md(ymd)}(${WEEKDAYS[weekdayOf(ymd)]})`;
/** 2026年10月24日(土) */
export const ymdw = (ymd: string) => `${ymd.slice(0, 4)}年${mdw(ymd)}`;
/** 10/24 */
export const slash = (ymd: string) => {
  const [, m, d] = parts(ymd);
  return `${m}/${d}`;
};
export const monthLabel = (ym: string, withYear = false) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return withYear ? `${y}年${m}月` : `${m}月`;
};

export const num = (n: number) => n.toLocaleString('ja-JP');
export const dec = (n: number | null) => (n === null ? '—' : n.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
export const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`);

/** 期間の見出し。年をまたぐときは終わりにも年を入れる。「2026年10月23日(金)〜10月29日(木)」 */
export function periodLabel(from: string, to: string) {
  if (from === to) return ymdw(from);
  return `${ymdw(from)}〜${from.slice(0, 4) === to.slice(0, 4) ? '' : `${to.slice(0, 4)}年`}${mdw(to)}`;
}

/** 区切りの短い名前(グラフの横軸) */
export function bucketTick(b: SeriesBucket, g: Granularity, withYear: boolean) {
  if (g === 'hour') return `${Number(b.start.slice(11, 13))}時`;
  if (g === 'month') return monthLabel(b.start.slice(0, 7), withYear);
  return slash(b.start);
}

/** 区切りの長い名前(吹き出しの見出し) */
export function bucketTitle(b: SeriesBucket, g: Granularity) {
  if (!b.start) return '';
  if (g === 'hour') return `${mdw(b.start.slice(0, 10))} ${Number(b.start.slice(11, 13))}時台`;
  if (g === 'day') return mdw(b.start);
  if (b.start === b.end) return mdw(b.start);
  return `${md(b.start)}〜${b.start.slice(0, 7) === b.end.slice(0, 7) ? `${Number(b.end.slice(8, 10))}日` : md(b.end)}`;
}

/** 区切りの CSV 用の名前 */
export function bucketCsv(b: SeriesBucket, g: Granularity) {
  if (g === 'hour') return `${b.start.slice(0, 10)} ${b.start.slice(11, 13)}時`;
  return b.start === b.end ? b.start : `${b.start}〜${b.end}`;
}

/** パネルの「CSV」。説明行 + 表を、UTF-8(BOM つき)で保存する(docs/design.md 12.2) */
export function savePanelCsv(args: {
  title: string;
  facilityName: string;
  period: string;
  unit: string;
  columns: CsvColumn[];
  rows: CsvValue[][];
  notes?: string[];
  fileName: string;
}) {
  const preamble = csvPreamble({
    title: `ダッシュボード「${args.title}」(CSV)`,
    facilityName: args.facilityName,
    exportedAt: toJstIso(new Date()),
    period: args.period,
    unit: args.unit,
    columns: args.columns,
    notes: [
      ...(args.notes ?? []),
      '取り消した来場と臨時休業日は数えていません。',
      '個人を特定できる情報(名前・LINEの名前・会員ID・郵便番号)は入っていません。',
    ],
    usage: [`このCSVをAIに渡し、『この「${args.title}」から分かることを教えて』と聞いてください。`],
  });
  const text = toCsv(
    args.columns.map((c) => c.name),
    args.rows,
    preamble,
  );
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = args.fileName;
  document.body.append(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 10_000);
}
