import type { WeatherKind } from './analytics';
import type { DayType } from './constants';

// API の応答の型(analytics: 分析と自動処理)

/** 自動処理の種類(system_jobs.name)。要件定義書 9.5 */
export const SYSTEM_JOB_NAMES = ['weather', 'holidays', 'daily_stats', 'backup', 'expiry', 'migration_images'] as const;
export type SystemJobName = (typeof SYSTEM_JOB_NAMES)[number];
export const SYSTEM_JOB_LABELS: Record<SystemJobName, string> = {
  weather: '天気の取得',
  holidays: '祝日の取り込み',
  daily_stats: '日別の集計',
  backup: 'バックアップ',
  expiry: '有効期限の処理',
  migration_images: '引き継ぎ申請の写真の削除',
};

/** 1回の実行の結果。warning は「一部だけできた」 */
export type SystemJobStatus = 'running' | 'ok' | 'warning' | 'failed';

/** 自動処理を手動で動かしたときの結果(POST /admin/api/holidays/import など) */
export type JobRunResult = { status: 'ok' | 'warning' | 'failed'; message: string };


/** 横棒グラフの1本 */
export type Bar = { label: string; count: number };

/** ダッシュボードの1日分(daily_stats・daily_weather・calendar・events から作る) */
export type DashboardDay = {
  date: string;
  /** 来場頭数(会員 + 会員以外) */
  dogs: number;
  dogsMember: number;
  dogsWalkin: number;
  /** 来場組数 */
  groups: number;
  newHouseholds: number;
  firstVisitHouseholds: number;
  ticketsUsed: number;
  /** 臨時休業日(指標から除く) */
  closed: boolean;
  /** 営業していた日として数えるか(臨時休業でなく、利用が始まった日以降で、今日まで) */
  open: boolean;
  dayType: DayType;
  holidayName: string | null;
  weather: WeatherKind | null;
  tempMax: number | null;
  tempMin: number | null;
  precipitation: number | null;
  events: string[];
};

export type DashboardMonth = {
  month: string;
  dogs: number;
  groups: number;
  newHouseholds: number;
  ticketsIssued: number;
  ticketsUsed: number;
  openDays: number;
};

/** リピート率の、初回来場月ごとの値 */
export type RepeatMonth = {
  month: string;
  /** その月に初めて来場したおうち(期間内) */
  firstTimers: number;
  /** そのうち、初回から repeatDays 日以内に2回目の来場があったおうち */
  repeaters: number;
  /** まだ repeatDays 日たっておらず、2回目が来ていないおうち(これから増えうる) */
  pending: number;
  rate: number | null;
};

/** おうちの継続状況(コホート)の1行。active[k] は初回来場月の k か月後に来場したおうちの数(先の月は null) */
export type CohortRow = { month: string; size: number; active: (number | null)[] };

export type DormantHousehold = {
  id: number;
  memberNo: string;
  displayName: string;
  /** これまでの来場回数 */
  visits: number;
  lastVisit: string;
  daysSince: number;
  dogs: { id: number; name: string; breedName: string; thumbUrl: string | null }[];
};

export type SurveySummary = {
  id: number;
  label: string;
  kind: 'choice' | 'text';
  target: 'member' | 'household';
  visible: boolean;
  /** 答えた人の数(答えなかった人を除く) */
  answered: number;
  answers: Bar[];
  /** 自由記述の新しい回答(5件まで) */
  recentTexts: string[];
};

/** GET /admin/api/dashboard の応答(A-01、13章) */
export type DashboardResponse = {
  from: string;
  to: string;
  today: string;
  /** full: 管理者・製作者 / summary: 受付スタッフ(13章の「見られる人」が「全員」の指標だけ) */
  scope: 'full' | 'summary';
  settings: { repeatDays: number; dormantDays: number; dormantMinVisits: number };
  totals: {
    dogs: number;
    dogsMember: number;
    dogsWalkin: number;
    groups: number;
    openDays: number;
    avgDogsPerDay: number | null;
    newHouseholds: number;
    firstVisitHouseholds: number;
    ticketsIssued: number;
    ticketsUsed: number;
    ticketUseRate: number | null;
  };
  days: DashboardDay[];
  months: DashboardMonth[];
  repeat: { months: RepeatMonth[]; firstTimers: number; repeaters: number; pending: number; rate: number | null };
  frequency: Bar[];
  weather: {
    byKind: { kind: WeatherKind; days: number; avgDogs: number | null }[];
    points: { date: string; tempMax: number; dogs: number }[];
    station: string | null;
    source: string | null;
  };
  dayTypes: { dayType: DayType; label: string; days: number; avgDogs: number | null }[];
  events: { date: string; names: string[]; dayType: DayType; dogs: number; baseline: number | null; diffPct: number | null }[];
  dogs: { total: number; breeds: Bar[]; sizes: Bar[]; ages: Bar[] };
  owners: { members: number; households: number; ageGroups: Bar[]; genders: Bar[]; areas: Bar[]; referrals: Bar[]; transports: Bar[] };
  cohort: { rows: CohortRow[]; offsets: number } | null;
  dormant: { total: number; households: DormantHousehold[] } | null;
  family: { households: number; multi: number; rate: number | null; avgVisitsMulti: number | null; avgVisitsSingle: number | null } | null;
  surveys: SurveySummary[] | null;
};
