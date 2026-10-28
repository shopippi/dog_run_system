import {
  closureCreateSchema,
  eventCreateSchema,
  monthSchema,
  toJstDate,
  toJstIso,
  weekdayOf,
  type AdminClosuresResponse,
  type AdminEvent,
  type AdminEventsResponse,
  type DayType,
} from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { requireRole } from '../../lib/staff-auth';
import { parseInput, parseJson } from '../../lib/validate';
import { auditStatement } from '../../services/audit';
import { registerUndo } from '../../services/undo';

// A-09 イベント・休業日(M-10)
// - イベントは events。削除は deleted_at(物理削除しない)
// - 臨時休業日は calendar の is_closed と closed_note。行がなければ作る(曜日と曜日区分も入れる)。
//   祝日名(holiday_name)は B-02 が入れるので触らない
// 注意: このファイルのルートは管理画面の API 全体に足されるので、use('*') で権限を付けない。ルートごとに付ける。
export const eventsRoutes = new Hono<AppEnv>();

/** 月の指定("2026-10")。なければ日本時間の今月 */
function monthRange(month: string | undefined, now: Date): { month: string; from: string; to: string } {
  const m = month ? parseInput(monthSchema, month) : toJstDate(now).slice(0, 7);
  return { month: m, from: `${m}-01`, to: `${m}-31` };
}

type EventRow = { id: number; date: string; name: string; kind: string | null; memo: string | null; deleted_at: string | null };
const toEvent = (r: EventRow): AdminEvent => ({ id: r.id, date: r.date, name: r.name, kind: r.kind, memo: r.memo });

async function findEvent(db: D1Database, id: number): Promise<EventRow> {
  const row = await db
    .prepare('SELECT id, date, name, kind, memo, deleted_at FROM events WHERE id = ?')
    .bind(id)
    .first<EventRow>();
  if (!row) throw errors.notFound('そのイベントが見つかりませんでした。画面を読み込み直してください。');
  return row;
}

/** 日付の曜日区分(祝日は B-02 が入れる。行を新しく作るときは、曜日だけで決める) */
function dayTypeOf(date: string): DayType {
  const w = weekdayOf(date);
  return w === 0 ? 'sunday' : w === 6 ? 'saturday' : 'weekday';
}

type CalendarRow = { date: string; is_closed: number; closed_note: string | null };
const findDay = (db: D1Database, date: string) =>
  db.prepare('SELECT date, is_closed, closed_note FROM calendar WHERE date = ?').bind(date).first<CalendarRow>();

/** 休業にする(行がなければ作る) */
const closeStatement = (db: D1Database, date: string, note: string | null, nowIso: string) =>
  db
    .prepare(
      `INSERT INTO calendar (date, weekday, holiday_name, day_type, is_closed, closed_note, updated_at)
       VALUES (?, ?, NULL, ?, 1, ?, ?)
       ON CONFLICT (date) DO UPDATE SET is_closed = 1, closed_note = excluded.closed_note, updated_at = excluded.updated_at`,
    )
    .bind(date, weekdayOf(date), dayTypeOf(date), note, nowIso);

const openStatement = (db: D1Database, date: string, nowIso: string) =>
  db.prepare('UPDATE calendar SET is_closed = 0, closed_note = NULL, updated_at = ? WHERE date = ?').bind(nowIso, date);

// ---- イベント ----

// 月のイベント。管理者(製作者は見るだけ)
eventsRoutes.get('/events', requireRole('admin'), async (c) => {
  const r = monthRange(c.req.query('month'), c.get('now'));
  const { results } = await c.env.DB.prepare(
    `SELECT id, date, name, kind, memo, deleted_at FROM events
      WHERE deleted_at IS NULL AND date BETWEEN ? AND ? ORDER BY date, id`,
  )
    .bind(r.from, r.to)
    .all<EventRow>();
  const body: AdminEventsResponse = { month: r.month, events: results.map(toEvent) };
  return c.json(body);
});

// イベントを追加する
eventsRoutes.post('/events', requireRole('admin'), async (c) => {
  const input = await parseJson(c, eventCreateSchema);
  const db = c.env.DB;
  const now = c.get('now');
  const res = await db.batch([
    db
      .prepare('INSERT INTO events (date, name, kind, memo, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(input.date, input.name, input.kind, input.memo || null, toJstIso(now)),
    auditStatement(db, {
      staffId: c.get('staff').id,
      action: 'event.create',
      targetType: 'event',
      targetId: { sql: 'last_insert_rowid()' },
      after: { date: input.date, name: input.name, kind: input.kind, memo: input.memo || null },
      now,
    }),
  ]);
  const event = toEvent(await findEvent(db, res[0]!.meta.last_row_id));
  return c.json({ event }, 201);
});

// イベントを消す(deleted_at を入れる。操作ログから元に戻せる)
eventsRoutes.delete('/events/:id', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const row = await findEvent(db, Number(c.req.param('id')) || 0);
  if (row.deleted_at) throw errors.notFound('このイベントは、もう消してあります。画面を読み込み直してください。');
  const now = c.get('now');
  await db.batch([
    db.prepare('UPDATE events SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').bind(toJstIso(now), row.id),
    auditStatement(db, {
      staffId: c.get('staff').id,
      action: 'event.delete',
      targetType: 'event',
      targetId: row.id,
      before: toEvent(row),
      now,
    }),
  ]);
  return c.json({ ok: true });
});

// ---- 臨時休業日 ----

// 月の臨時休業日と祝日
eventsRoutes.get('/closures', requireRole('admin'), async (c) => {
  const r = monthRange(c.req.query('month'), c.get('now'));
  const { results } = await c.env.DB.prepare(
    `SELECT date, is_closed, closed_note, holiday_name FROM calendar
      WHERE date BETWEEN ? AND ? AND (is_closed = 1 OR holiday_name IS NOT NULL) ORDER BY date`,
  )
    .bind(r.from, r.to)
    .all<CalendarRow & { holiday_name: string | null }>();
  const body: AdminClosuresResponse = {
    month: r.month,
    closures: results.filter((x) => x.is_closed === 1).map((x) => ({ date: x.date, note: x.closed_note })),
    holidays: results.filter((x) => x.holiday_name).map((x) => ({ date: x.date, name: x.holiday_name! })),
  };
  return c.json(body);
});

// 臨時休業日にする。すでに休業日なら、理由だけ変える
eventsRoutes.post('/closures', requireRole('admin'), async (c) => {
  const input = await parseJson(c, closureCreateSchema);
  const db = c.env.DB;
  const now = c.get('now');
  const before = await findDay(db, input.date);
  const note = input.note || null;
  await db.batch([
    closeStatement(db, input.date, note, toJstIso(now)),
    auditStatement(db, {
      staffId: c.get('staff').id,
      action: 'closure.create',
      targetType: 'calendar',
      targetId: input.date,
      before: { isClosed: before?.is_closed === 1, note: before?.closed_note ?? null },
      after: { isClosed: true, note },
      now,
    }),
  ]);
  return c.json({ date: input.date, note }, 201);
});

// 臨時休業日をやめる(行は残し、is_closed を 0 にする)
eventsRoutes.delete('/closures/:date', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const date = c.req.param('date');
  const day = await findDay(db, date);
  if (!day || day.is_closed !== 1) throw errors.notFound('この日は臨時休業日ではありません。画面を読み込み直してください。');
  const now = c.get('now');
  await db.batch([
    openStatement(db, date, toJstIso(now)),
    auditStatement(db, {
      staffId: c.get('staff').id,
      action: 'closure.delete',
      targetType: 'calendar',
      targetId: date,
      before: { isClosed: true, note: day.closed_note },
      after: { isClosed: false, note: null },
      now,
    }),
  ]);
  return c.json({ ok: true });
});

// ---- 操作ログから元に戻す(A-15) ----

registerUndo('event.create', async (db, log, ctx) => {
  const row = await findEvent(db, Number(log.target_id));
  if (row.deleted_at) throw errors.conflict('event_changed', 'このイベントは、もう消してあります。');
  await db.prepare('UPDATE events SET deleted_at = ? WHERE id = ?').bind(toJstIso(ctx.now), row.id).run();
});

registerUndo('event.delete', async (db, log) => {
  const row = await findEvent(db, Number(log.target_id));
  if (!row.deleted_at) throw errors.conflict('event_changed', 'このイベントは、もう元に戻っています。');
  await db.prepare('UPDATE events SET deleted_at = NULL WHERE id = ?').bind(row.id).run();
});

/** 休業日の操作を元に戻す。そのあとにまた変えられていたら戻さない */
const undoClosure = async (db: D1Database, log: { target_id: string | null; before_value: string | null; after_value: string | null }, now: Date) => {
  const date = log.target_id ?? '';
  const before = JSON.parse(log.before_value ?? '{}') as { isClosed: boolean; note: string | null };
  const after = JSON.parse(log.after_value ?? '{}') as { isClosed: boolean; note: string | null };
  const day = await findDay(db, date);
  const current = { isClosed: day?.is_closed === 1, note: day?.closed_note ?? null };
  if (current.isClosed !== after.isClosed || current.note !== after.note) {
    throw errors.conflict('closure_changed', 'この日は、そのあとにまた変更されています。イベント・休業日の画面で直してください。');
  }
  const nowIso = toJstIso(now);
  await (before.isClosed ? closeStatement(db, date, before.note, nowIso) : openStatement(db, date, nowIso)).run();
};
registerUndo('closure.create', (db, log, ctx) => undoClosure(db, log, ctx.now));
registerUndo('closure.delete', (db, log, ctx) => undoClosure(db, log, ctx.now));
