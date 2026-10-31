import {
  AGE_BUCKETS,
  AGE_GROUPS,
  DASHBOARD_MAX_DAYS,
  DAY_TYPES,
  DOG_SIZES,
  DOG_SIZE_LABELS,
  DOG_SOCIABILITY,
  DOG_SOCIABILITY_LABELS,
  EVENT_INTERESTS,
  GENDERS,
  PREFERRED_TIMES,
  YES_NO,
  decodeMultiAnswer,
  type DogSociability,
  REFERRALS,
  TRANSPORTS,
  WEATHER_KINDS,
  addDays,
  ageBucket,
  average,
  cohortTable,
  countBars,
  daysBetween,
  dashboardQuerySchema,
  dayTypeOf,
  findDormant,
  frequencyBuckets,
  groupVisits,
  monthOf,
  monthsInRange,
  repeatStats,
  toJstDate,
  type DashboardDay,
  type DashboardResponse,
  type DayType,
  type SurveySummary,
  type WeatherKind,
  dashboardRangeSchema,
  granularityOf,
  resolveRange,
  weatherVisits,
} from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { loadSettings } from '../../lib/settings';
import { parseInput } from '../../lib/validate';
import { ADMIN_MEDIA_BASE, canSeePersonal } from '../../services/admin-visits';
import { buildAreas, buildTrend } from '../../services/dashboard-trend';

// A-01 ダッシュボード(M-05)。指標の定義は要件定義書 13章。
// - 日別の指標(頭数・組数・天気・曜日・イベント・新規おうち・無料券の利用)は daily_stats・daily_weather・calendar から読む
//   (来場記録全体を毎回読まない。14章の設計上の注意)
// - おうち単位の指標(リピート率・コホート・頻度・休眠)は visits の household_id と visit_date だけを読む
// - 取り消した来場と臨時休業日は、すべての指標から除く
// - 受付スタッフには、13章の「見られる人」が「全員」の指標だけを返す(コホート・休眠・家族での利用・追加したアンケートは返さない)
export const dashboardRoutes = new Hono<AppEnv>();

const DAY_TYPE_LABELS: Record<DayType, string> = { weekday: '平日', saturday: '土曜', sunday: '日曜', holiday: '祝日' };
/** 休眠している常連の一覧に出す数 */
const DORMANT_LIST_MAX = 30;
/** 郵便番号(上3桁)の構成で出す地域の数。それより少ない地域は「そのほかの地域」にまとめる */
const AREA_MAX = 10;

const NOT_CLOSED = (dateExpr: string) =>
  `NOT EXISTS (SELECT 1 FROM calendar cc WHERE cc.date = ${dateExpr} AND cc.is_closed = 1)`;

function lastDayOfMonth(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return `${date.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

dashboardRoutes.get('/dashboard', async (c) => {
  const db = c.env.DB;
  const staff = c.get('staff');
  const today = toJstDate(c.get('now'));
  const q = parseInput(dashboardQuerySchema, { from: c.req.query('from'), to: c.req.query('to') });
  // 2026-10-29: 右上の期間の切り替え(?range=24h|7d|30d|90d|12m|custom)。custom と省略のときは from・to を使う
  const rangeParam = c.req.query('range');
  const range = rangeParam ? parseInput(dashboardRangeSchema, rangeParam) : 'custom';
  const resolved = range !== 'custom' ? resolveRange(range, today) : null;
  const from = resolved?.from ?? q.from ?? `${today.slice(0, 7)}-01`;
  const to = resolved?.to ?? q.to ?? (q.from && q.from > today ? q.from : today);
  if (from > to) throw errors.badRequest('期間の始まりが終わりより後になっています。期間を選び直してください。');
  if (daysBetween(from, to) + 1 > DASHBOARD_MAX_DAYS) {
    throw errors.badRequest('一度に見られるのは3年分までです。期間を短くして選び直してください。');
  }
  const full = canSeePersonal(staff.role);
  const settings = await loadSettings(db);
  /** 集計の終わり(今日より先は数えない) */
  const end = to < today ? to : today;
  const hasDays = end >= from;
  const rangeEnd = hasDays ? end : from;
  // イベントの効果は「同じ月・同じ曜日区分の通常日」と比べるので、月の初めから終わりまで読む
  const extFrom = `${monthOf(from)}-01`;
  const extTo = lastDayOfMonth(to) < today ? lastDayOfMonth(to) : today;

  const [statsRes, calRes, weatherRes, eventsRes, startRes, closedRes, ticketsRes] = await db.batch([
    db
      .prepare(
        `SELECT date, visit_groups, dogs_member, dogs_walkin, new_households, first_visit_households, tickets_used
           FROM daily_stats WHERE date BETWEEN ? AND ?`,
      )
      .bind(extFrom, extTo),
    db.prepare('SELECT date, holiday_name, day_type, is_closed FROM calendar WHERE date BETWEEN ? AND ?').bind(extFrom, extTo),
    db
      .prepare('SELECT date, weather, temp_max, temp_min, precipitation, station, source FROM daily_weather WHERE date BETWEEN ? AND ?')
      .bind(extFrom, extTo),
    db.prepare('SELECT date, name FROM events WHERE deleted_at IS NULL AND date BETWEEN ? AND ? ORDER BY date, id').bind(extFrom, extTo),
    // 利用が始まった日(これより前の日は「営業していた日」に数えない)
    db.prepare('SELECT MIN(date) AS d FROM daily_stats WHERE visit_groups > 0'),
    db.prepare('SELECT date FROM calendar WHERE is_closed = 1'),
    db
      .prepare(
        `SELECT substr(t.issued_at, 1, 7) AS m, COUNT(*) AS n FROM tickets t
          WHERE t.status <> 'void' AND t.issued_at >= ? AND t.issued_at < ? AND ${NOT_CLOSED('substr(t.issued_at, 1, 10)')}
          GROUP BY substr(t.issued_at, 1, 7)`,
      )
      .bind(from, addDays(rangeEnd, 1)),
  ]);

  type StatRow = {
    date: string;
    visit_groups: number;
    dogs_member: number;
    dogs_walkin: number;
    new_households: number;
    first_visit_households: number;
    tickets_used: number;
  };
  const stats = new Map((statsRes!.results as StatRow[]).map((r) => [r.date, r]));
  type CalRow = { date: string; holiday_name: string | null; day_type: DayType; is_closed: number };
  const cal = new Map((calRes!.results as CalRow[]).map((r) => [r.date, r]));
  type WeatherRow = {
    date: string;
    weather: string | null;
    temp_max: number | null;
    temp_min: number | null;
    precipitation: number | null;
    station: string | null;
    source: string | null;
  };
  const weatherRows = weatherRes!.results as WeatherRow[];
  const weather = new Map(weatherRows.map((r) => [r.date, r]));
  const eventsByDate = new Map<string, string[]>();
  for (const e of eventsRes!.results as { date: string; name: string }[]) {
    eventsByDate.set(e.date, [...(eventsByDate.get(e.date) ?? []), e.name]);
  }
  const start = (startRes!.results[0] as { d: string | null } | undefined)?.d ?? null;
  const closedDates = new Set((closedRes!.results as { date: string }[]).map((r) => r.date));
  const issuedByMonth = new Map((ticketsRes!.results as { m: string; n: number }[]).map((r) => [r.m, r.n]));

  // ---- 1日ごとの値 ----
  const extDays: DashboardDay[] = [];
  for (let d = extFrom; d <= extTo; d = addDays(d, 1)) {
    const s = stats.get(d);
    const k = cal.get(d);
    const w = weather.get(d);
    const closed = k?.is_closed === 1 || closedDates.has(d);
    const kind = w?.weather && (WEATHER_KINDS as readonly string[]).includes(w.weather) ? (w.weather as WeatherKind) : null;
    const dogsMember = closed ? 0 : (s?.dogs_member ?? 0);
    const dogsWalkin = closed ? 0 : (s?.dogs_walkin ?? 0);
    extDays.push({
      date: d,
      dogs: dogsMember + dogsWalkin,
      dogsMember,
      dogsWalkin,
      groups: closed ? 0 : (s?.visit_groups ?? 0),
      newHouseholds: closed ? 0 : (s?.new_households ?? 0),
      firstVisitHouseholds: closed ? 0 : (s?.first_visit_households ?? 0),
      ticketsUsed: closed ? 0 : (s?.tickets_used ?? 0),
      closed,
      open: !closed && start !== null && d >= start && d <= today,
      dayType: k?.day_type ?? dayTypeOf(d, null),
      holidayName: k?.holiday_name ?? null,
      weather: kind,
      tempMax: w?.temp_max ?? null,
      tempMin: w?.temp_min ?? null,
      precipitation: w?.precipitation ?? null,
      events: eventsByDate.get(d) ?? [],
    });
  }
  const days = hasDays ? extDays.filter((d) => d.date >= from && d.date <= end) : [];
  const openDays = days.filter((d) => d.open);
  const sum = (list: DashboardDay[], f: (d: DashboardDay) => number) => list.reduce((acc, d) => acc + f(d), 0);

  const months = monthsInRange(from, to).map((m) => {
    const list = days.filter((d) => monthOf(d.date) === m);
    return {
      month: m,
      dogs: sum(list, (d) => d.dogs),
      groups: sum(list, (d) => d.groups),
      newHouseholds: sum(list, (d) => d.newHouseholds),
      ticketsIssued: hasDays ? (issuedByMonth.get(m) ?? 0) : 0,
      ticketsUsed: sum(list, (d) => d.ticketsUsed),
      openDays: list.filter((d) => d.open).length,
    };
  });
  const ticketsIssued = months.reduce((acc, m) => acc + m.ticketsIssued, 0);
  const ticketsUsed = sum(days, (d) => d.ticketsUsed);

  // ---- 天気・気温・曜日・イベント ----
  const byKind = WEATHER_KINDS.map((kind) => {
    const list = openDays.filter((d) => d.weather === kind);
    return { kind, days: list.length, avgDogs: average(list.map((d) => d.dogs)) };
  });
  const points = openDays.filter((d) => d.tempMax !== null).map((d) => ({ date: d.date, tempMax: d.tempMax!, dogs: d.dogs }));
  const latestWeather = weatherRows.filter((r) => r.date >= from && r.date <= rangeEnd).at(-1);
  const dayTypes = DAY_TYPES.map((t) => {
    const list = openDays.filter((d) => d.dayType === t);
    return { dayType: t, label: DAY_TYPE_LABELS[t], days: list.length, avgDogs: average(list.map((d) => d.dogs)) };
  });
  const events = openDays
    .filter((d) => d.events.length > 0)
    .map((d) => {
      const normal = extDays.filter(
        (x) => x.open && x.events.length === 0 && monthOf(x.date) === monthOf(d.date) && x.dayType === d.dayType,
      );
      const baseline = average(normal.map((x) => x.dogs));
      return {
        date: d.date,
        names: d.events,
        dayType: d.dayType,
        dogs: d.dogs,
        baseline,
        diffPct: baseline ? Math.round(((d.dogs - baseline) / baseline) * 100) : null,
      };
    });

  // ---- おうち単位の指標(visits の household_id と visit_date だけを読む) ----
  const pairs = await db
    .prepare(
      `SELECT household_id, visit_date FROM visits
        WHERE household_id IS NOT NULL AND cancelled_at IS NULL AND visit_date <= ?
        ORDER BY household_id, visit_date`,
    )
    .bind(today)
    .raw<[number, string]>();
  const visits = groupVisits(pairs, closedDates);
  const repeat = repeatStats(visits, { from, to: rangeEnd, today, repeatDays: settings.repeat_days });
  const frequency = frequencyBuckets(visits, { from, to: rangeEnd });

  // ---- 犬・飼い主の構成(期間中に来場した犬・家族・おうち) ----
  const inRange = `v.visit_date BETWEEN ?1 AND ?2 AND v.cancelled_at IS NULL AND ${NOT_CLOSED('v.visit_date')}`;
  const [dogRes, memberRes, householdRes, fixedRes] = await db.batch([
    db
      .prepare(
        `SELECT DISTINCT COALESCE(d.merged_into_id, d.id) AS id, b.name AS breed, d.size, d.birth_ym, d.sociability
           FROM visit_dogs vd JOIN visits v ON v.id = vd.visit_id JOIN dogs d ON d.id = vd.dog_id JOIN breeds b ON b.id = d.breed_id
          WHERE ${inRange}`,
      )
      .bind(from, rangeEnd),
    db
      .prepare(
        `SELECT DISTINCT m.id, m.age_group, m.gender FROM visits v JOIN family_members m ON m.id = v.checked_in_member_id
          WHERE ${inRange}`,
      )
      .bind(from, rangeEnd),
    db
      .prepare(
        `SELECT DISTINCT h.id, h.postal_code, h.referral, h.transport, h.preferred_times, h.event_interests, h.uses_other_runs
           FROM visits v JOIN households h ON h.id = v.household_id
          WHERE ${inRange}`,
      )
      .bind(from, rangeEnd),
    db.prepare('SELECT fixed_key, options FROM survey_questions WHERE fixed_key IS NOT NULL'),
  ]);
  type DogRow = { id: number; breed: string; size: keyof typeof DOG_SIZE_LABELS; birth_ym: string | null; sociability: DogSociability | null };
  const dogRows = hasDays ? (dogRes!.results as DogRow[]) : [];
  const seenDog = new Set<number>();
  const uniqueDogs = dogRows.filter((d) => {
    if (seenDog.has(d.id)) return false;
    seenDog.add(d.id);
    return true;
  });
  const fixedOptions = new Map<string, string[]>();
  for (const r of fixedRes!.results as { fixed_key: string; options: string }[]) {
    try {
      fixedOptions.set(r.fixed_key, JSON.parse(r.options) as string[]);
    } catch {
      // 選択肢が読めなければ、決まった順に並べる
    }
  }
  const members = hasDays ? (memberRes!.results as { id: number; age_group: string | null; gender: string | null }[]) : [];
  type HouseholdRow = {
    id: number;
    postal_code: string | null;
    referral: string | null;
    transport: string | null;
    /** 来たい時間帯・興味のあるイベント(JSON の配列)、ほかのドッグランの利用(1 / 0)。担当J */
    preferred_times: string | null;
    event_interests: string | null;
    uses_other_runs: number | null;
  };
  /** 複数選択の内訳: 選んだ選択肢ごとにおうちを数える(1軒が複数に入る)。答えていないおうちは「未回答」 */
  const multiBars = (stored: (string | null)[], order: readonly string[]) =>
    countBars(
      stored.flatMap((v) => {
        const list = decodeMultiAnswer(v);
        return list.length ? list : [null];
      }),
      order,
    );
  const households = hasDays ? (householdRes!.results as HouseholdRow[]) : [];
  const areaBars = countBars(
    households.map((h) => (h.postal_code && /^\d{3}/.test(h.postal_code) ? `〒${h.postal_code.slice(0, 3)}` : null)),
  ).sort((a, b) => (a.label === '未回答' ? 1 : b.label === '未回答' ? -1 : b.count - a.count));
  const answeredAreas = areaBars.filter((b) => b.label !== '未回答');
  const areas =
    answeredAreas.length > AREA_MAX
      ? [
          ...answeredAreas.slice(0, AREA_MAX),
          { label: 'そのほかの地域', count: answeredAreas.slice(AREA_MAX).reduce((acc, b) => acc + b.count, 0) },
          ...areaBars.filter((b) => b.label === '未回答'),
        ]
      : areaBars;

  // ---- 推移(KPI のカード・大きなグラフ)・天気と来場・地域(docs/design.md 12章) ----
  const { trend, facts } = await buildTrend(db, {
    range,
    granularity: granularityOf(range, from, to),
    from,
    to,
    today,
    now: c.get('now'),
    visits,
    repeatDays: settings.repeat_days,
  });
  const inPeriod = facts.filter((f) => f.date >= from && f.date <= rangeEnd && hasDays);
  const areasBlock = hasDays ? await buildAreas(db, from, rangeEnd) : await buildAreas(db, from, addDays(from, -1));

  const body: DashboardResponse = {
    from,
    to,
    today,
    scope: full ? 'full' : 'summary',
    settings: { repeatDays: settings.repeat_days, dormantDays: settings.dormant_days, dormantMinVisits: settings.dormant_min_visits },
    totals: {
      dogs: sum(days, (d) => d.dogs),
      dogsMember: sum(days, (d) => d.dogsMember),
      dogsWalkin: sum(days, (d) => d.dogsWalkin),
      groups: sum(days, (d) => d.groups),
      openDays: openDays.length,
      avgDogsPerDay: average(openDays.map((d) => d.dogs)),
      newHouseholds: sum(days, (d) => d.newHouseholds),
      firstVisitHouseholds: sum(days, (d) => d.firstVisitHouseholds),
      ticketsIssued,
      ticketsUsed,
      ticketUseRate: ticketsIssued > 0 ? ticketsUsed / ticketsIssued : null,
    },
    days,
    months,
    repeat: hasDays ? repeat : { ...repeat, firstTimers: 0, repeaters: 0, pending: 0, rate: null },
    frequency: hasDays ? frequency : frequency.map((b) => ({ ...b, count: 0 })),
    weather: { byKind, points, station: latestWeather?.station ?? null, source: latestWeather?.source ?? null },
    dayTypes,
    events,
    dogs: {
      total: uniqueDogs.length,
      breeds: countBars(uniqueDogs.map((d) => d.breed)).sort((a, b) => b.count - a.count),
      sizes: countBars(
        uniqueDogs.map((d) => DOG_SIZE_LABELS[d.size]),
        DOG_SIZES.map((s) => DOG_SIZE_LABELS[s]),
      ),
      ages: countBars(
        uniqueDogs.map((d) => ageBucket(d.birth_ym, rangeEnd)),
        AGE_BUCKETS,
      ),
      sociability: countBars(
        uniqueDogs.map((d) => (d.sociability ? DOG_SOCIABILITY_LABELS[d.sociability] : null)),
        DOG_SOCIABILITY.map((x) => DOG_SOCIABILITY_LABELS[x]),
      ),
    },
    owners: {
      members: members.length,
      households: households.length,
      ageGroups: countBars(members.map((m) => m.age_group), fixedOptions.get('age_group') ?? AGE_GROUPS),
      genders: countBars(members.map((m) => m.gender), fixedOptions.get('gender') ?? GENDERS),
      areas,
      referrals: countBars(households.map((h) => h.referral), fixedOptions.get('referral') ?? REFERRALS),
      transports: countBars(households.map((h) => h.transport), fixedOptions.get('transport') ?? TRANSPORTS),
      preferredTimes: multiBars(households.map((h) => h.preferred_times), fixedOptions.get('preferred_times') ?? PREFERRED_TIMES),
      eventInterests: multiBars(households.map((h) => h.event_interests), fixedOptions.get('event_interests') ?? EVENT_INTERESTS),
      otherRuns: countBars(
        households.map((h) => (h.uses_other_runs === 1 ? YES_NO[0] : h.uses_other_runs === 0 ? YES_NO[1] : null)),
        YES_NO,
      ),
    },
    cohort: null,
    dormant: null,
    family: null,
    surveys: null,
    trend,
    weatherVisits: weatherVisits(inPeriod),
    areas: areasBlock,
  };

  if (full) {
    body.cohort = hasDays ? cohortTable(visits, { from, to: rangeEnd, today }) : { rows: [], offsets: 0 };
    body.dormant = await dormantList(db, visits, today, settings);
    body.family = await familyUsage(db, visits, households.map((h) => h.id), from, rangeEnd);
    body.surveys = await surveySummaries(db);
  }
  return c.json(body);
});

/** 休眠している常連(管理者・製作者)。犬の写真つき。今日の時点で判定する */
async function dormantList(
  db: D1Database,
  visits: ReturnType<typeof groupVisits>,
  today: string,
  settings: { dormant_days: number; dormant_min_visits: number },
): Promise<NonNullable<DashboardResponse['dormant']>> {
  const all = findDormant(visits, { today, dormantDays: settings.dormant_days, minVisits: settings.dormant_min_visits });
  if (all.length === 0) return { total: 0, households: [] };
  const { results: active } = await db
    .prepare(
      `SELECT id, member_no, display_name FROM households
        WHERE status = 'active' AND id IN (SELECT value FROM json_each(?))`,
    )
    .bind(JSON.stringify(all.map((d) => d.householdId)))
    .all<{ id: number; member_no: string; display_name: string }>();
  const info = new Map(active.map((h) => [h.id, h]));
  const list = all.filter((d) => info.has(d.householdId));
  const top = list.slice(0, DORMANT_LIST_MAX);
  const { results: dogs } = await db
    .prepare(
      `SELECT d.household_id, d.id, d.name, COALESCE(d.breed_other, b.name) AS breed_name, d.thumb_key
         FROM dogs d JOIN breeds b ON b.id = d.breed_id
        WHERE d.status = 'active' AND d.household_id IN (SELECT value FROM json_each(?))
        ORDER BY d.id`,
    )
    .bind(JSON.stringify(top.map((d) => d.householdId)))
    .all<{ household_id: number; id: number; name: string; breed_name: string; thumb_key: string | null }>();
  return {
    total: list.length,
    households: top.map((d) => {
      const h = info.get(d.householdId)!;
      return {
        id: h.id,
        memberNo: h.member_no,
        displayName: h.display_name,
        visits: d.visits,
        lastVisit: d.lastVisit,
        daysSince: d.daysSince,
        dogs: dogs
          .filter((x) => x.household_id === h.id)
          .map((x) => ({
            id: x.id,
            name: x.name,
            breedName: x.breed_name,
            thumbUrl: x.thumb_key ? `${ADMIN_MEDIA_BASE}/${x.thumb_key}` : null,
          })),
      };
    }),
  };
}

/** 家族での利用(管理者・製作者)。期間中に来場したおうちのうち、家族が2人以上つながっているおうちの割合と来場回数 */
async function familyUsage(
  db: D1Database,
  visits: ReturnType<typeof groupVisits>,
  householdIds: number[],
  from: string,
  to: string,
): Promise<NonNullable<DashboardResponse['family']>> {
  if (householdIds.length === 0) return { households: 0, multi: 0, rate: null, avgVisitsMulti: null, avgVisitsSingle: null };
  const { results } = await db
    .prepare(
      `SELECT household_id, COUNT(*) AS n FROM family_members
        WHERE status = 'active' AND household_id IN (SELECT value FROM json_each(?))
        GROUP BY household_id`,
    )
    .bind(JSON.stringify(householdIds))
    .all<{ household_id: number; n: number }>();
  const familySize = new Map(results.map((r) => [r.household_id, r.n]));
  const countIn = (id: number) => (visits.get(id) ?? []).filter((d) => d >= from && d <= to).length;
  const multi = householdIds.filter((id) => (familySize.get(id) ?? 0) >= 2);
  const single = householdIds.filter((id) => (familySize.get(id) ?? 0) < 2);
  return {
    households: householdIds.length,
    multi: multi.length,
    rate: multi.length / householdIds.length,
    avgVisitsMulti: average(multi.map(countIn)),
    avgVisitsSingle: average(single.map(countIn)),
  };
}

/** 管理者が追加したアンケートの回答の構成(管理者・製作者)。これまでのすべての回答 */
async function surveySummaries(db: D1Database): Promise<SurveySummary[]> {
  const [qRes, aRes, tRes] = await db.batch([
    db.prepare(`SELECT id, label, kind, multiple, target, options, visible FROM survey_questions WHERE is_fixed = 0 ORDER BY sort_order, id`),
    db.prepare(
      `SELECT a.question_id, a.answer, COUNT(*) AS n FROM survey_answers a JOIN survey_questions q ON q.id = a.question_id
        WHERE q.is_fixed = 0 AND q.kind = 'choice' AND a.skipped = 0 AND a.answer IS NOT NULL
        GROUP BY a.question_id, a.answer`,
    ),
    db.prepare(
      `SELECT a.question_id, a.answer FROM survey_answers a JOIN survey_questions q ON q.id = a.question_id
        WHERE q.is_fixed = 0 AND q.kind = 'text' AND a.skipped = 0 AND a.answer IS NOT NULL AND a.answer <> ''
        ORDER BY a.answered_at DESC, a.id DESC`,
    ),
  ]);
  type Q = { id: number; label: string; kind: 'choice' | 'text'; multiple: number; target: 'member' | 'household'; options: string; visible: number };
  const choiceCounts = aRes!.results as { question_id: number; answer: string; n: number }[];
  const texts = tRes!.results as { question_id: number; answer: string }[];
  return (qRes!.results as Q[]).map((q) => {
    let options: string[] = [];
    try {
      options = JSON.parse(q.options) as string[];
    } catch {
      options = [];
    }
    const base = { id: q.id, label: q.label, kind: q.kind, target: q.target, visible: q.visible === 1 };
    if (q.kind === 'choice') {
      const rows = choiceCounts.filter((r) => r.question_id === q.id);
      if (q.multiple === 1) {
        // いくつでも選ぶ質問(担当J): 選んだ選択肢ごとに数える。答えた人の数は回答の数
        const picked = rows.flatMap((r) => decodeMultiAnswer(r.answer).flatMap((o) => Array<string>(r.n).fill(o)));
        const answered = rows.reduce((acc, r) => acc + r.n, 0);
        return { ...base, answered, answers: countBars(picked, options), recentTexts: [] };
      }
      const values = rows.flatMap((r) => Array<string>(r.n).fill(r.answer));
      return { ...base, answered: values.length, answers: countBars(values, options), recentTexts: [] };
    }
    const mine = texts.filter((t) => t.question_id === q.id);
    return { ...base, answered: mine.length, answers: [], recentTexts: mine.slice(0, 5).map((t) => t.answer) };
  });
}
