import type { WeatherKind } from './analytics';
import type { AdminVisit } from './api-types';
import type { DayType } from './constants';

// ダッシュボードの作り直し(docs/design.md 12章、2026-10-29)の API の型。
// GET /admin/api/dashboard の応答(DashboardResponse)に足す部分と、日ごとのカレンダー・日の詳細・日々のメモ・地域。

/** 期間の切り替え(右上のセグメント)。URL の ?range= に残す */
export const DASHBOARD_RANGES = ['24h', '7d', '30d', '90d', '12m', 'custom'] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];
export const DASHBOARD_RANGE_LABELS: Record<DashboardRange, string> = {
  '24h': '24時間',
  '7d': '7日',
  '30d': '30日',
  '90d': '90日',
  '12m': '12か月',
  custom: '期間を選ぶ',
};

/** 大きなグラフの横軸のまとめ方 */
export type Granularity = 'hour' | 'day' | 'week' | 'month';

/** 推移の1区切り(1時間・1日・1週・1か月) */
export type SeriesBucket = {
  /** 始まり。時間のときは "2026-10-29T13"(日本時間)、それ以外は日付 */
  start: string;
  /** 終わり(含む)。時間のときは start と同じ */
  end: string;
  /** 来場組数(会員以外の入力も1件として数える) */
  groups: number;
  /** 会員のおうちの来場組数 */
  memberGroups: number;
  /** 来場頭数(会員 + 会員以外) */
  dogs: number;
  dogsMember: number;
  dogsWalkin: number;
  newHouseholds: number;
  ticketsUsed: number;
  /** その区切りの日のメモ(1行目) */
  notes: string[];
  events: string[];
  /** 1日の区切りのときだけ: 天気・最高気温・臨時休業 */
  weather: WeatherKind | null;
  tempMax: number | null;
  closed: boolean;
};

/** KPI のカード・大きなグラフで切り替えられる数字 */
export const SERIES_METRICS = ['groups', 'dogs', 'dogsWalkin', 'newHouseholds', 'ticketsUsed'] as const;
export type SeriesMetric = (typeof SERIES_METRICS)[number];
export const SERIES_METRIC_LABELS: Record<SeriesMetric, { label: string; unit: string; desc: string }> = {
  groups: { label: '来場組数', unit: '組', desc: 'チェックインの件数(会員以外の入力も1件として数える。取り消しを除く)' },
  dogs: { label: '来場頭数', unit: '頭', desc: '来場したワンちゃんの合計(会員以外を含む)' },
  dogsWalkin: { label: '会員以外の頭数', unit: '頭', desc: '受付で入力した会員以外のワンちゃんの数' },
  newHouseholds: { label: '新しいおうち', unit: '軒', desc: '会員IDを発行したおうちの数' },
  ticketsUsed: { label: '無料券の使用', unit: '枚', desc: '使われた無料券の枚数' },
};

export type DashboardTrend = {
  range: DashboardRange;
  granularity: Granularity;
  /** 比べる前の期間(同じ長さ)。24時間のときは日時 */
  previous: { from: string; to: string };
  current: SeriesBucket[];
  /** 前の期間。current と同じ数で、同じ位置を比べる */
  previousBuckets: SeriesBucket[];
  totals: Record<SeriesMetric, number>;
  previousTotals: Record<SeriesMetric, number>;
  /** リピート率(前の期間) */
  previousRepeatRate: number | null;
  previousRepeatMonths: { month: string; rate: number | null }[];
};

/** 天気ごとの来場(パネル「天気と来場」)。dayGroup: all = すべて / weekend = 土日祝 / weekday = 平日 */
export type WeatherVisitsRow = {
  kind: WeatherKind;
  dayGroup: 'all' | 'weekend' | 'weekday';
  /** その天気の営業日の数 */
  days: number;
  /** 1日あたりの来場組数(平均) */
  avgGroups: number | null;
  /** 1日あたりの会員の来場組数 */
  avgMemberGroups: number | null;
  /** 1日あたりの会員以外の頭数 */
  avgWalkinDogs: number | null;
  avgDogs: number | null;
};

/** どこから来ているか(地域)の1行 */
export type AreaRow = {
  /** 都道府県 + 市区町村(例: 東京都 世田谷区) */
  key: string;
  prefecture: string;
  city: string;
  /** 期間中に来場したおうちの数 */
  households: number;
  /** 期間中の来場の数(おうちの来場の回数) */
  visits: number;
  towns: { town: string; households: number; visits: number }[];
};
export type DashboardAreas = {
  rows: AreaRow[];
  /** 郵便番号を答えていないおうち */
  noPostal: { households: number; visits: number };
  /** まだ調べていない郵便番号のおうち(「今すぐ調べる」で調べられる) */
  pending: { households: number; visits: number; codes: number };
  /** 調べても見つからなかった郵便番号のおうち */
  notFound: { households: number; visits: number };
};

/** 日ごとのカレンダーの1マス(GET /admin/api/dashboard/days) */
export type CalendarDay = {
  date: string;
  dayType: DayType;
  holidayName: string | null;
  closed: boolean;
  closedNote: string | null;
  weather: WeatherKind | null;
  tempMax: number | null;
  tempMin: number | null;
  precipitation: number | null;
  groups: number;
  memberGroups: number;
  dogs: number;
  events: string[];
  noteCount: number;
  /** 今日より先の日 */
  future: boolean;
};
export type DashboardDaysResponse = { month: string; today: string; days: CalendarDay[]; maxGroups: number };

/** 日々のメモ(day_notes) */
export type DayNote = {
  id: number;
  date: string;
  body: string;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
};
export type DayNotesResponse = { notes: DayNote[] };
export type DayNoteSaved = { note: DayNote; auditId: number | null };

/** 日の詳細(GET /admin/api/dashboard/day/:date) */
export type DashboardDayResponse = {
  date: string;
  today: string;
  dayType: DayType;
  holidayName: string | null;
  closed: boolean;
  closedNote: string | null;
  weather: { kind: WeatherKind | null; tempMax: number | null; tempMin: number | null; precipitation: number | null; station: string | null } | null;
  totals: {
    groups: number;
    memberGroups: number;
    dogs: number;
    dogsMember: number;
    dogsWalkin: number;
    newHouseholds: number;
    firstVisitHouseholds: number;
    ticketsUsed: number;
  };
  /** 1時間ごとの来場(0〜23時) */
  hourly: { hour: number; groups: number; dogs: number }[];
  events: { name: string; kind: string | null; memo: string | null }[];
  notes: DayNote[];
};

/** その日の来場の一覧(今日の来場と同じ形。GET /admin/api/dashboard/day/:date/visits) */
export type DayVisitsResponse = {
  date: string;
  visits: AdminVisit[];
  totals: { groups: number; memberDogs: number; walkinDogs: number; ticketsUsed: number };
};
