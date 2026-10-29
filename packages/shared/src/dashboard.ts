import { addMonthsToDate, average, daysBetween, monthOf, WEATHER_KINDS, type WeatherKind } from './analytics';
import type { Bar } from './api-types-analytics';
import type { DashboardRange, Granularity, SeriesBucket, WeatherVisitsRow } from './api-types-dashboard';
import type { DayType } from './constants';
import { addDays } from './date';

// ダッシュボードの作り直し(docs/design.md 12章)のロジック。API と画面で共有し、単体テストで確かめる。

/** 期間の切り替えから、日付の期間を決める。24時間は「昨日と今日」(内訳の表はこの2日で数える) */
export function resolveRange(range: DashboardRange, today: string, custom?: { from: string; to: string }): { from: string; to: string } {
  switch (range) {
    case '24h':
      return { from: addDays(today, -1), to: today };
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case '90d':
      return { from: addDays(today, -89), to: today };
    case '12m':
      return { from: addDays(addMonthsToDate(today, -12), 1), to: today };
    default:
      return custom ?? { from: addDays(today, -29), to: today };
  }
}

/** 比べる前の期間(同じ長さで、すぐ前) */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const len = daysBetween(from, to) + 1;
  const prevTo = addDays(from, -1);
  return { from: addDays(prevTo, -(len - 1)), to: prevTo };
}

/** 大きなグラフの横軸のまとめ方。24時間は1時間ごと、92日までは1日ごと、400日までは1週ごと、それより長いと1か月ごと */
export function granularityOf(range: DashboardRange, from: string, to: string): Granularity {
  if (range === '24h') return 'hour';
  const len = daysBetween(from, to) + 1;
  if (len <= 92) return 'day';
  if (len <= 400) return 'week';
  return 'month';
}

/** 1日分の値(バケツにまとめる前) */
export type DayValues = {
  date: string;
  groups: number;
  memberGroups: number;
  dogs: number;
  dogsMember: number;
  dogsWalkin: number;
  newHouseholds: number;
  ticketsUsed: number;
  notes: string[];
  events: string[];
  weather: WeatherKind | null;
  tempMax: number | null;
  closed: boolean;
};

const emptyBucket = (start: string, end: string): SeriesBucket => ({
  start,
  end,
  groups: 0,
  memberGroups: 0,
  dogs: 0,
  dogsMember: 0,
  dogsWalkin: 0,
  newHouseholds: 0,
  ticketsUsed: 0,
  notes: [],
  events: [],
  weather: null,
  tempMax: null,
  closed: false,
});

/** 期間の区切り(日・週・月)の一覧。週は期間の始まりから7日ずつ、月は暦の月(期間で切る) */
export function bucketRanges(from: string, to: string, granularity: Exclude<Granularity, 'hour'>): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  if (to < from) return out;
  if (granularity === 'day') {
    for (let d = from; d <= to; d = addDays(d, 1)) out.push({ start: d, end: d });
  } else if (granularity === 'week') {
    for (let d = from; d <= to; d = addDays(d, 7)) {
      const end = addDays(d, 6);
      out.push({ start: d, end: end < to ? end : to });
    }
  } else {
    let start = from;
    while (start <= to) {
      const nextMonth = addMonthsToDate(`${monthOf(start)}-01`, 1);
      const end = addDays(nextMonth, -1);
      out.push({ start, end: end < to ? end : to });
      start = nextMonth;
    }
  }
  return out;
}

/** 1日ごとの値を、区切りごとに合計する。今日より先の日は数えない(0 のまま) */
export function bucketDays(days: DayValues[], from: string, to: string, granularity: Exclude<Granularity, 'hour'>): SeriesBucket[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  return bucketRanges(from, to, granularity).map(({ start, end }) => {
    const b = emptyBucket(start, end);
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const v = byDate.get(d);
      if (!v) continue;
      b.groups += v.groups;
      b.memberGroups += v.memberGroups;
      b.dogs += v.dogs;
      b.dogsMember += v.dogsMember;
      b.dogsWalkin += v.dogsWalkin;
      b.newHouseholds += v.newHouseholds;
      b.ticketsUsed += v.ticketsUsed;
      b.notes.push(...v.notes);
      b.events.push(...v.events);
    }
    if (granularity === 'day') {
      const v = byDate.get(start);
      b.weather = v?.weather ?? null;
      b.tempMax = v?.tempMax ?? null;
      b.closed = v?.closed ?? false;
    }
    return b;
  });
}

/** 1時間ごとの値(24時間)。hours は "2026-10-29T13" の形の時刻の一覧(古い順) */
export function hourBuckets(
  hours: string[],
  rows: { hour: string; groups: number; memberGroups: number; dogsMember: number; dogsWalkin: number; newHouseholds: number; ticketsUsed: number }[],
): SeriesBucket[] {
  const byHour = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const prev = byHour.get(r.hour);
    byHour.set(
      r.hour,
      prev
        ? {
            hour: r.hour,
            groups: prev.groups + r.groups,
            memberGroups: prev.memberGroups + r.memberGroups,
            dogsMember: prev.dogsMember + r.dogsMember,
            dogsWalkin: prev.dogsWalkin + r.dogsWalkin,
            newHouseholds: prev.newHouseholds + r.newHouseholds,
            ticketsUsed: prev.ticketsUsed + r.ticketsUsed,
          }
        : r,
    );
  }
  return hours.map((h) => {
    const b = emptyBucket(h, h);
    const r = byHour.get(h);
    if (r) {
      b.groups = r.groups;
      b.memberGroups = r.memberGroups;
      b.dogsMember = r.dogsMember;
      b.dogsWalkin = r.dogsWalkin;
      b.dogs = r.dogsMember + r.dogsWalkin;
      b.newHouseholds = r.newHouseholds;
      b.ticketsUsed = r.ticketsUsed;
    }
    return b;
  });
}

/** 日本時間の時刻 "2026-10-29T13" の k 時間後 */
export function addHourKey(hourKey: string, k: number): string {
  const [date, hh] = hourKey.split('T') as [string, string];
  const total = Number(hh) + k;
  const dayShift = Math.floor(total / 24);
  const h = ((total % 24) + 24) % 24;
  return `${addDays(date, dayShift)}T${String(h).padStart(2, '0')}`;
}

/** 前の期間との差(%)。前が 0 のときは null(比べられない) */
export function diffPct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** 土日祝(土曜・日曜・平日の祝日)か */
export const isWeekendType = (t: DayType) => t !== 'weekday';

/**
 * 天気ごとの来場(パネル「天気と来場」。docs/design.md 12.3)。
 * 営業日(臨時休業でなく、利用が始まった日から今日まで)だけを数え、天気の分からない日は入れない。
 */
export function weatherVisits(
  days: { open: boolean; weather: WeatherKind | null; dayType: DayType; groups: number; memberGroups: number; dogs: number; dogsWalkin: number }[],
): WeatherVisitsRow[] {
  const out: WeatherVisitsRow[] = [];
  for (const dayGroup of ['all', 'weekend', 'weekday'] as const) {
    for (const kind of WEATHER_KINDS) {
      const list = days.filter(
        (d) =>
          d.open &&
          d.weather === kind &&
          (dayGroup === 'all' || (dayGroup === 'weekend' ? isWeekendType(d.dayType) : !isWeekendType(d.dayType))),
      );
      out.push({
        kind,
        dayGroup,
        days: list.length,
        avgGroups: average(list.map((d) => d.groups)),
        avgMemberGroups: average(list.map((d) => d.memberGroups)),
        avgWalkinDogs: average(list.map((d) => d.dogsWalkin)),
        avgDogs: average(list.map((d) => d.dogs)),
      });
    }
  }
  return out;
}

/** 郵便番号を7桁の数字にそろえる(「154-0001」「〒1540001」「１５４００01」も読む)。読めなければ null */
export function normalizePostal(code: string | null | undefined): string | null {
  if (!code) return null;
  const digits = code.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\D/g, '');
  return /^\d{7}$/.test(digits) ? digits : null;
}

/** zipcloud の応答から、都道府県・市区町村・町域を取り出す。見つからなければ null。形が違えば投げる */
export function parseZipcloud(json: unknown): { prefecture: string; city: string; town: string } | null {
  const body = json as { status?: number; message?: string | null; results?: { address1?: string; address2?: string; address3?: string }[] | null };
  if (!body || typeof body !== 'object' || typeof body.status !== 'number') throw new Error('zipcloud の応答の形が違います');
  if (body.status !== 200) throw new Error(`zipcloud: ${body.status} ${body.message ?? ''}`.trim());
  const first = body.results?.[0];
  if (!first) return null;
  return { prefecture: first.address1 ?? '', city: first.address2 ?? '', town: first.address3 ?? '' };
}

/**
 * 内訳の表を「上位 n 件 + そのほか」にする(docs/design.md 12.1)。
 * 決まった順の選択肢(サイズ・年齢など)で n 件以下なら、そのままの順。多いときは多い順に並べ替える。
 * 「未回答」はいつも最後に残す。
 */
export function topBars(bars: Bar[], n = 8, keepOrder = false): Bar[] {
  const empty = bars.filter((b) => b.label === '未回答');
  const rest = bars.filter((b) => b.label !== '未回答');
  if (rest.length <= n + 1) return keepOrder ? bars : [...[...rest].sort((a, b) => b.count - a.count), ...empty];
  const sorted = [...rest].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const other = sorted.slice(n).reduce((s, b) => s + b.count, 0);
  return [...sorted.slice(0, n), { label: 'そのほか', count: other }, ...empty];
}
