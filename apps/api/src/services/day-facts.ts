import { addDays, dayTypeOf, firstLine, WEATHER_KINDS, weekdayOf, type DayType, type DayValues, type WeatherKind } from '@dr/shared';

// 1日ごとの事実(来場・天気・祝日・休業・イベント・メモ)。ダッシュボードの推移・日ごとのカレンダー・日の詳細・
// AI に渡す分析パックの CSV で使う(docs/design.md 12章)。
// 来場の数は日別の集計(daily_stats)から読み、会員のおうちの来場組数だけ visits から日ごとに数える(行は読まない)。
// 臨時休業日は、すべての数を 0 にする(13章)。

export type DayFact = DayValues & {
  weekday: number;
  dayType: DayType;
  holidayName: string | null;
  closedNote: string | null;
  tempMin: number | null;
  precipitation: number | null;
  station: string | null;
  firstVisitHouseholds: number;
  /** その日に発行した無料券(ポイントとの交換・手動・引き継ぎ。取り消しで回収したものを除く) */
  ticketsIssued: number;
  /** メモの全文(新しい順ではなく、書いた順) */
  noteBodies: string[];
  /** 営業していた日として数えるか(臨時休業でなく、利用が始まった日から今日まで) */
  open: boolean;
  future: boolean;
};

export async function loadDayFacts(db: D1Database, from: string, to: string, today: string): Promise<DayFact[]> {
  if (to < from) return [];
  const [statsRes, calRes, weatherRes, eventsRes, memberRes, issuedRes, notesRes, startRes] = await db.batch([
    db
      .prepare(
        `SELECT date, visit_groups, dogs_member, dogs_walkin, new_households, first_visit_households, tickets_used
           FROM daily_stats WHERE date BETWEEN ? AND ?`,
      )
      .bind(from, to),
    db.prepare('SELECT date, holiday_name, day_type, is_closed, closed_note FROM calendar WHERE date BETWEEN ? AND ?').bind(from, to),
    db
      .prepare('SELECT date, weather, temp_max, temp_min, precipitation, station FROM daily_weather WHERE date BETWEEN ? AND ?')
      .bind(from, to),
    db.prepare('SELECT date, name FROM events WHERE deleted_at IS NULL AND date BETWEEN ? AND ? ORDER BY date, id').bind(from, to),
    db
      .prepare(
        `SELECT visit_date AS date, COUNT(*) AS n FROM visits
          WHERE visit_date BETWEEN ? AND ? AND household_id IS NOT NULL AND cancelled_at IS NULL
          GROUP BY visit_date`,
      )
      .bind(from, to),
    db
      .prepare(
        `SELECT substr(issued_at, 1, 10) AS date, COUNT(*) AS n FROM tickets
          WHERE status <> 'void' AND issued_at >= ? AND issued_at < ?
          GROUP BY substr(issued_at, 1, 10)`,
      )
      .bind(from, addDays(to, 1)),
    db
      .prepare('SELECT date, body FROM day_notes WHERE deleted_at IS NULL AND date BETWEEN ? AND ? ORDER BY date, id')
      .bind(from, to),
    db.prepare('SELECT MIN(date) AS d FROM daily_stats WHERE visit_groups > 0'),
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
  type CalRow = { date: string; holiday_name: string | null; day_type: DayType; is_closed: number; closed_note: string | null };
  const cal = new Map((calRes!.results as CalRow[]).map((r) => [r.date, r]));
  type WeatherRow = { date: string; weather: string | null; temp_max: number | null; temp_min: number | null; precipitation: number | null; station: string | null };
  const weather = new Map((weatherRes!.results as WeatherRow[]).map((r) => [r.date, r]));
  const group = <T extends { date: string }, V>(rows: T[], value: (r: T) => V) => {
    const m = new Map<string, V[]>();
    for (const r of rows) m.set(r.date, [...(m.get(r.date) ?? []), value(r)]);
    return m;
  };
  const events = group(eventsRes!.results as { date: string; name: string }[], (r) => r.name);
  const notes = group(notesRes!.results as { date: string; body: string }[], (r) => r.body);
  const memberGroups = new Map((memberRes!.results as { date: string; n: number }[]).map((r) => [r.date, r.n]));
  const issued = new Map((issuedRes!.results as { date: string; n: number }[]).map((r) => [r.date, r.n]));
  const start = (startRes!.results[0] as { d: string | null } | undefined)?.d ?? null;

  const out: DayFact[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const s = stats.get(d);
    const k = cal.get(d);
    const w = weather.get(d);
    const closed = k?.is_closed === 1;
    const z = (n: number | undefined) => (closed ? 0 : (n ?? 0));
    const kind = w?.weather && (WEATHER_KINDS as readonly string[]).includes(w.weather) ? (w.weather as WeatherKind) : null;
    const bodies = notes.get(d) ?? [];
    const dogsMember = z(s?.dogs_member);
    const dogsWalkin = z(s?.dogs_walkin);
    out.push({
      date: d,
      weekday: weekdayOf(d),
      dayType: k?.day_type ?? dayTypeOf(d, null),
      holidayName: k?.holiday_name ?? null,
      closed,
      closedNote: k?.closed_note ?? null,
      weather: kind,
      tempMax: w?.temp_max ?? null,
      tempMin: w?.temp_min ?? null,
      precipitation: w?.precipitation ?? null,
      station: w?.station ?? null,
      groups: z(s?.visit_groups),
      memberGroups: z(memberGroups.get(d)),
      dogs: dogsMember + dogsWalkin,
      dogsMember,
      dogsWalkin,
      newHouseholds: z(s?.new_households),
      firstVisitHouseholds: z(s?.first_visit_households),
      ticketsUsed: z(s?.tickets_used),
      ticketsIssued: issued.get(d) ?? 0,
      events: events.get(d) ?? [],
      notes: bodies.map((b) => firstLine(b)),
      noteBodies: bodies,
      open: !closed && start !== null && d >= start && d <= today,
      future: d > today,
    });
  }
  return out;
}
