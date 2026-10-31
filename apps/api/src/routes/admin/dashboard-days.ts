import {
  addDays,
  addMonthsToDate,
  dashboardMonthSchema,
  noteDateSchema,
  toJstDate,
  type CalendarDay,
  type DashboardDayResponse,
  type DashboardDaysResponse,
  type DayVisitsResponse,
} from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { parseInput } from '../../lib/validate';
import { errors } from '../../lib/errors';
import { listVisitsOn, totalsOf } from '../../services/admin-visits';
import { loadDayFacts } from '../../services/day-facts';
import { listDayNotes } from './day-notes';

// ダッシュボードの日ごとのカレンダーと日の詳細(docs/design.md 12.3)。全員が見られる(集計の値と、その日のメモだけ)。
// 注意: このファイルのルートは管理画面の API 全体に足されるので、use('*') で権限を付けない。
export const dashboardDaysRoutes = new Hono<AppEnv>();

// 月のカレンダー(?month=2026-10。省略すると今月)
dashboardDaysRoutes.get('/dashboard/days', async (c) => {
  const today = toJstDate(c.get('now'));
  const month = c.req.query('month') ? parseInput(dashboardMonthSchema, c.req.query('month')) : today.slice(0, 7);
  const from = `${month}-01`;
  const to = addDays(addMonthsToDate(from, 1), -1);
  const facts = await loadDayFacts(c.env.DB, from, to, today);
  const days: CalendarDay[] = facts.map((f) => ({
    date: f.date,
    dayType: f.dayType,
    holidayName: f.holidayName,
    closed: f.closed,
    closedNote: f.closedNote,
    weather: f.weather,
    tempMax: f.tempMax,
    tempMin: f.tempMin,
    precipitation: f.precipitation,
    groups: f.future ? 0 : f.groups,
    memberGroups: f.future ? 0 : f.memberGroups,
    dogs: f.future ? 0 : f.dogs,
    events: f.events,
    noteCount: f.noteBodies.length,
    future: f.future,
  }));
  const body: DashboardDaysResponse = { month, today, days, maxGroups: Math.max(0, ...days.map((d) => d.groups)) };
  return c.json(body);
});

// 日の詳細(天気・内訳・1時間ごとの来場・イベント・メモ)
dashboardDaysRoutes.get('/dashboard/day/:date', async (c) => {
  const db = c.env.DB;
  const today = toJstDate(c.get('now'));
  const date = parseInput(noteDateSchema, c.req.param('date'));
  const [facts, hourRes, eventRes, notes] = await Promise.all([
    loadDayFacts(db, date, date, today),
    db
      .prepare(
        `SELECT CAST(substr(checked_in_at, 12, 2) AS INTEGER) AS hour, COUNT(*) AS groups, SUM(dog_count) AS dogs
           FROM visits WHERE visit_date = ? AND cancelled_at IS NULL
          GROUP BY substr(checked_in_at, 12, 2)`,
      )
      .bind(date)
      .all<{ hour: number; groups: number; dogs: number }>(),
    db
      .prepare('SELECT name, kind, memo FROM events WHERE deleted_at IS NULL AND date = ? ORDER BY id')
      .bind(date)
      .all<{ name: string; kind: string | null; memo: string | null }>(),
    listDayNotes(db, date, date),
  ]);
  const f = facts[0]!;
  const byHour = new Map(hourRes.results.map((r) => [r.hour, r]));
  const body: DashboardDayResponse = {
    date,
    today,
    dayType: f.dayType,
    holidayName: f.holidayName,
    closed: f.closed,
    closedNote: f.closedNote,
    weather:
      f.weather || f.tempMax !== null || f.precipitation !== null
        ? { kind: f.weather, tempMax: f.tempMax, tempMin: f.tempMin, precipitation: f.precipitation, station: f.station }
        : null,
    totals: {
      groups: f.groups,
      memberGroups: f.memberGroups,
      dogs: f.dogs,
      dogsMember: f.dogsMember,
      dogsWalkin: f.dogsWalkin,
      newHouseholds: f.newHouseholds,
      firstVisitHouseholds: f.firstVisitHouseholds,
      ticketsUsed: f.ticketsUsed,
    },
    // 臨時休業日は 0(13章。指標から除く)
    hourly: Array.from({ length: 24 }, (_, hour) => {
      const r = f.closed ? undefined : byHour.get(hour);
      return { hour, groups: r?.groups ?? 0, dogs: r?.dogs ?? 0 };
    }),
    events: eventRes.results,
    notes,
  };
  return c.json(body);
});

// その日の来場の一覧(今日の来場と同じ形)。受付スタッフには、今日の来場と同じ範囲だけを出す
dashboardDaysRoutes.get('/dashboard/day/:date/visits', async (c) => {
  const date = parseInput(noteDateSchema, c.req.param('date'));
  // 受付スタッフが見られる来場の一覧は今日の分だけ(3.2。ほかの日は集計だけ)
  if (c.get('staff').role === 'staff' && date !== toJstDate(c.get('now'))) {
    throw errors.forbidden('受付スタッフが見られる来場の一覧は、今日の分だけです。ほかの日の来場は、管理者に見てもらってください。');
  }
  const visits = await listVisitsOn(c.env.DB, date, c.get('staff').role);
  const body: DayVisitsResponse = { date, visits, totals: totalsOf(visits) };
  return c.json(body);
});
