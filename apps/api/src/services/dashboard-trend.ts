import {
  addHourKey,
  bucketDays,
  hourBuckets,
  normalizePostal,
  previousPeriod,
  repeatStats,
  SERIES_METRICS,
  toJstIso,
  type AreaRow,
  type DashboardAreas,
  type DashboardRange,
  type DashboardTrend,
  type Granularity,
  type HouseholdVisits,
  type SeriesBucket,
  type SeriesMetric,
} from '@dr/shared';
import { loadDayFacts, type DayFact } from './day-facts';

// ダッシュボードの推移(KPI のカード・大きなグラフ)と地域(docs/design.md 12.1・12.3)

const NOT_CLOSED = (dateExpr: string) =>
  `NOT EXISTS (SELECT 1 FROM calendar cc WHERE cc.date = ${dateExpr} AND cc.is_closed = 1)`;

const sumOf = (buckets: SeriesBucket[]) =>
  Object.fromEntries(SERIES_METRICS.map((m) => [m, buckets.reduce((s, b) => s + b[m], 0)])) as Record<SeriesMetric, number>;

/** 24時間: 1時間ごとの来場(visits の checked_in_at を日本時間の時で数える)。前の24時間も */
async function hourly(db: D1Database, now: Date): Promise<{ current: SeriesBucket[]; previous: SeriesBucket[]; prev: { from: string; to: string } }> {
  const nowHour = toJstIso(now).slice(0, 13);
  const hours = Array.from({ length: 24 }, (_, i) => addHourKey(nowHour, i - 23));
  const prevHours = Array.from({ length: 24 }, (_, i) => addHourKey(nowHour, i - 47));
  const startKey = prevHours[0]!;
  const endKey = `${nowHour}:59:59+09:00`;
  const [visitsRes, regRes, ticketRes] = await db.batch([
    db
      .prepare(
        `SELECT substr(checked_in_at, 1, 13) AS hour, COUNT(*) AS groups,
                SUM(CASE WHEN household_id IS NOT NULL THEN 1 ELSE 0 END) AS member_groups,
                SUM(CASE WHEN household_id IS NOT NULL THEN dog_count ELSE 0 END) AS dogs_member,
                SUM(CASE WHEN household_id IS NULL THEN dog_count ELSE 0 END) AS dogs_walkin
           FROM visits
          WHERE checked_in_at >= ? AND checked_in_at <= ? AND cancelled_at IS NULL AND ${NOT_CLOSED('visit_date')}
          GROUP BY substr(checked_in_at, 1, 13)`,
      )
      .bind(startKey, endKey),
    db
      .prepare(
        `SELECT substr(registered_at, 1, 13) AS hour, COUNT(*) AS n FROM households
          WHERE registered_at >= ? AND registered_at <= ? GROUP BY substr(registered_at, 1, 13)`,
      )
      .bind(startKey, endKey),
    db
      .prepare(
        `SELECT substr(used_at, 1, 13) AS hour, COUNT(*) AS n FROM tickets
          WHERE status = 'used' AND used_at >= ? AND used_at <= ? GROUP BY substr(used_at, 1, 13)`,
      )
      .bind(startKey, endKey),
  ]);
  type V = { hour: string; groups: number; member_groups: number; dogs_member: number; dogs_walkin: number };
  const rows = [
    ...(visitsRes!.results as V[]).map((r) => ({
      hour: r.hour,
      groups: r.groups,
      memberGroups: r.member_groups,
      dogsMember: r.dogs_member,
      dogsWalkin: r.dogs_walkin,
      newHouseholds: 0,
      ticketsUsed: 0,
    })),
    ...(regRes!.results as { hour: string; n: number }[]).map((r) => ({
      hour: r.hour,
      groups: 0,
      memberGroups: 0,
      dogsMember: 0,
      dogsWalkin: 0,
      newHouseholds: r.n,
      ticketsUsed: 0,
    })),
    ...(ticketRes!.results as { hour: string; n: number }[]).map((r) => ({
      hour: r.hour,
      groups: 0,
      memberGroups: 0,
      dogsMember: 0,
      dogsWalkin: 0,
      newHouseholds: 0,
      ticketsUsed: r.n,
    })),
  ];
  return {
    current: hourBuckets(hours, rows),
    previous: hourBuckets(prevHours, rows),
    prev: { from: prevHours[0]!, to: prevHours[23]! },
  };
}

/**
 * 推移(KPI のカード・大きなグラフ)。前の同じ長さの期間も同じ区切りで作り、同じ位置どうしを比べる。
 * days には、前の期間の始まりから期間の終わりまでの 1日ごとの事実を渡す。
 */
export async function buildTrend(
  db: D1Database,
  args: {
    range: DashboardRange;
    granularity: Granularity;
    from: string;
    to: string;
    today: string;
    now: Date;
    visits: HouseholdVisits;
    repeatDays: number;
  },
): Promise<{ trend: DashboardTrend; facts: DayFact[] }> {
  const prev = previousPeriod(args.from, args.to);
  const facts = await loadDayFacts(db, prev.from, args.to, args.today);
  const prevRepeat = repeatStats(args.visits, { from: prev.from, to: prev.to, today: args.today, repeatDays: args.repeatDays });
  let current: SeriesBucket[];
  let previousBuckets: SeriesBucket[];
  let previous = prev;
  if (args.granularity === 'hour') {
    const h = await hourly(db, args.now);
    current = h.current;
    previousBuckets = h.previous;
    previous = h.prev;
  } else {
    // 今日より先の日は数えない
    const live = facts.filter((f) => !f.future);
    current = bucketDays(live, args.from, args.to, args.granularity);
    previousBuckets = bucketDays(live, prev.from, prev.to, args.granularity);
    // 月ごとの区切りは、前の期間と数が違うことがあるので、同じ数にそろえる
    while (previousBuckets.length < current.length) previousBuckets.unshift({ ...current[0]!, ...zero(), start: '', end: '' });
    if (previousBuckets.length > current.length) previousBuckets = previousBuckets.slice(-current.length);
  }
  return {
    facts,
    trend: {
      range: args.range,
      granularity: args.granularity,
      previous,
      current,
      previousBuckets,
      totals: sumOf(current),
      previousTotals: sumOf(previousBuckets),
      previousRepeatRate: prevRepeat.rate,
      previousRepeatMonths: prevRepeat.months.map((m) => ({ month: m.month, rate: m.rate })),
    },
  };
}

const zero = () => ({
  groups: 0,
  memberGroups: 0,
  dogs: 0,
  dogsMember: 0,
  dogsWalkin: 0,
  newHouseholds: 0,
  ticketsUsed: 0,
  notes: [] as string[],
  events: [] as string[],
  weather: null,
  tempMax: null,
  closed: false,
});

/**
 * どこから来ているか(地域)。期間中に来場したおうちを、郵便番号から調べた市区町村ごとに数える。
 * 来場の数は、おうちの来場の回数(取り消しと臨時休業日を除く)。
 */
export async function buildAreas(db: D1Database, from: string, to: string): Promise<DashboardAreas> {
  const empty: DashboardAreas = {
    rows: [],
    noPostal: { households: 0, visits: 0 },
    pending: { households: 0, visits: 0, codes: 0 },
    notFound: { households: 0, visits: 0 },
  };
  if (to < from) return empty;
  const { results } = await db
    .prepare(
      `SELECT h.id, h.postal_code, COUNT(*) AS visits
         FROM visits v JOIN households h ON h.id = v.household_id
        WHERE v.visit_date BETWEEN ? AND ? AND v.cancelled_at IS NULL AND ${NOT_CLOSED('v.visit_date')}
        GROUP BY h.id`,
    )
    .bind(from, to)
    .all<{ id: number; postal_code: string | null; visits: number }>();
  if (results.length === 0) return empty;
  const codes = [...new Set(results.map((r) => normalizePostal(r.postal_code)).filter((c): c is string => c !== null))];
  const { results: areas } = codes.length
    ? await db
        .prepare(
          `SELECT postal_code, prefecture, city, town, status FROM postal_areas
            WHERE postal_code IN (SELECT value FROM json_each(?))`,
        )
        .bind(JSON.stringify(codes))
        .all<{ postal_code: string; prefecture: string | null; city: string | null; town: string | null; status: string }>()
    : { results: [] };
  const areaOf = new Map(areas.map((a) => [a.postal_code, a]));
  const out = { ...empty, noPostal: { households: 0, visits: 0 }, pending: { households: 0, visits: 0, codes: 0 }, notFound: { households: 0, visits: 0 } };
  const rows = new Map<string, AreaRow>();
  const pendingCodes = new Set<string>();
  for (const r of results) {
    const code = normalizePostal(r.postal_code);
    if (!code) {
      out.noPostal.households += 1;
      out.noPostal.visits += r.visits;
      continue;
    }
    const a = areaOf.get(code);
    if (!a) {
      pendingCodes.add(code);
      out.pending.households += 1;
      out.pending.visits += r.visits;
      continue;
    }
    if (a.status !== 'found' || !a.city) {
      out.notFound.households += 1;
      out.notFound.visits += r.visits;
      continue;
    }
    const key = `${a.prefecture ?? ''} ${a.city}`.trim();
    const row = rows.get(key) ?? { key, prefecture: a.prefecture ?? '', city: a.city, households: 0, visits: 0, towns: [] };
    row.households += 1;
    row.visits += r.visits;
    const townName = a.town || '(町域なし)';
    const town = row.towns.find((t) => t.town === townName);
    if (town) {
      town.households += 1;
      town.visits += r.visits;
    } else row.towns.push({ town: townName, households: 1, visits: r.visits });
    rows.set(key, row);
  }
  out.pending.codes = pendingCodes.size;
  out.rows = [...rows.values()]
    .map((r) => ({ ...r, towns: r.towns.sort((a, b) => b.visits - a.visits || b.households - a.households || a.town.localeCompare(b.town)) }))
    .sort((a, b) => b.visits - a.visits || b.households - a.households || a.key.localeCompare(b.key));
  return out;
}
