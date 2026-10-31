import {
  dayNoteCreateSchema,
  dayNotesQuerySchema,
  dayNoteUpdateSchema,
  firstLine,
  toJstIso,
  type DayNote,
  type DayNoteSaved,
  type DayNotesResponse,
} from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { requireRole } from '../../lib/staff-auth';
import { parseInput, parseJson } from '../../lib/validate';
import { auditStatement, latestAuditId } from '../../services/audit';
import { registerAuditDetail } from '../../services/audit-view';
import { registerUndo } from '../../services/undo';

// 日々のメモ(docs/design.md 12.3)。「この日はイベントがあった」「午後から雨」などを、日付ごとに残す。
// - 見る: 全員。書く・直す・消す: 受付スタッフと管理者(製作者は見るだけ。requireStaff が変更系を 403 にする)
// - 消すときは deleted_at を入れる(物理削除しない)。書く・直す・消すは操作ログに残り、元に戻せる
// 注意: このファイルのルートは管理画面の API 全体に足されるので、use('*') で権限を付けない。ルートごとに付ける。
export const dayNotesRoutes = new Hono<AppEnv>();

type NoteRow = {
  id: number;
  date: string;
  body: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: string | null;
  updated_by: string | null;
};

const SELECT = `SELECT n.id, n.date, n.body, n.created_at, n.updated_at, n.deleted_at, c.name AS created_by, u.name AS updated_by
                  FROM day_notes n
                  LEFT JOIN staff_users c ON c.id = n.created_by_staff_id
                  LEFT JOIN staff_users u ON u.id = n.updated_by_staff_id`;

export const toDayNote = (r: NoteRow): DayNote => ({
  id: r.id,
  date: r.date,
  body: r.body,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedBy: r.updated_at !== r.created_at ? r.updated_by : null,
  updatedAt: r.updated_at,
});

/** その日(または期間)の、消していないメモ。書いた順 */
export async function listDayNotes(db: D1Database, from: string, to: string): Promise<DayNote[]> {
  const { results } = await db
    .prepare(`${SELECT} WHERE n.deleted_at IS NULL AND n.date BETWEEN ? AND ? ORDER BY n.date, n.id`)
    .bind(from, to)
    .all<NoteRow>();
  return results.map(toDayNote);
}

async function findNote(db: D1Database, id: number): Promise<NoteRow> {
  const row = await db.prepare(`${SELECT} WHERE n.id = ?`).bind(id).first<NoteRow>();
  if (!row) throw errors.notFound('そのメモが見つかりませんでした。画面を読み込み直してください。');
  return row;
}

const snapshot = (r: { date: string; body: string }) => ({ date: r.date, body: r.body });

// メモの一覧(?date=2026-10-29 か、?from=…&to=…)。全員
dayNotesRoutes.get('/day-notes', async (c) => {
  const q = parseInput(dayNotesQuerySchema, {
    date: c.req.query('date') || undefined,
    from: c.req.query('from') || undefined,
    to: c.req.query('to') || undefined,
  });
  const body: DayNotesResponse = { notes: await listDayNotes(c.env.DB, q.date ?? q.from!, q.date ?? q.to!) };
  return c.json(body);
});

// メモを書く。受付スタッフ・管理者
dayNotesRoutes.post('/day-notes', requireRole('staff', 'admin'), async (c) => {
  const input = await parseJson(c, dayNoteCreateSchema);
  const db = c.env.DB;
  const now = c.get('now');
  const staff = c.get('staff');
  const nowIso = toJstIso(now);
  const res = await db.batch([
    db
      .prepare(
        `INSERT INTO day_notes (date, body, created_by_staff_id, created_at, updated_by_staff_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(input.date, input.body, staff.id, nowIso, staff.id, nowIso),
    auditStatement(db, {
      staffId: staff.id,
      action: 'day_note.create',
      targetType: 'day_note',
      targetId: { sql: 'last_insert_rowid()' },
      after: snapshot(input),
      now,
    }),
  ]);
  const id = res[0]!.meta.last_row_id;
  const body: DayNoteSaved = {
    note: toDayNote(await findNote(db, id)),
    auditId: await latestAuditId(db, { action: 'day_note.create', targetType: 'day_note', targetId: id, staffId: staff.id }),
  };
  return c.json(body, 201);
});

// メモを直す。受付スタッフ・管理者
dayNotesRoutes.patch('/day-notes/:id', requireRole('staff', 'admin'), async (c) => {
  const input = await parseJson(c, dayNoteUpdateSchema);
  const db = c.env.DB;
  const row = await findNote(db, Number(c.req.param('id')) || 0);
  if (row.deleted_at) throw errors.notFound('このメモは、もう消してあります。画面を読み込み直してください。');
  const now = c.get('now');
  const staff = c.get('staff');
  if (row.body !== input.body) {
    await db.batch([
      db
        .prepare('UPDATE day_notes SET body = ?, updated_by_staff_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
        .bind(input.body, staff.id, toJstIso(now), row.id),
      auditStatement(db, {
        staffId: staff.id,
        action: 'day_note.update',
        targetType: 'day_note',
        targetId: row.id,
        before: snapshot(row),
        after: { date: row.date, body: input.body },
        now,
      }),
    ]);
  }
  const body: DayNoteSaved = {
    note: toDayNote(await findNote(db, row.id)),
    auditId:
      row.body !== input.body
        ? await latestAuditId(db, { action: 'day_note.update', targetType: 'day_note', targetId: row.id, staffId: staff.id })
        : null,
  };
  return c.json(body);
});

// メモを消す(deleted_at を入れる。操作ログから元に戻せる)。受付スタッフ・管理者
dayNotesRoutes.delete('/day-notes/:id', requireRole('staff', 'admin'), async (c) => {
  const db = c.env.DB;
  const row = await findNote(db, Number(c.req.param('id')) || 0);
  if (row.deleted_at) throw errors.notFound('このメモは、もう消してあります。画面を読み込み直してください。');
  const now = c.get('now');
  const staff = c.get('staff');
  await db.batch([
    db.prepare('UPDATE day_notes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').bind(toJstIso(now), row.id),
    auditStatement(db, {
      staffId: staff.id,
      action: 'day_note.delete',
      targetType: 'day_note',
      targetId: row.id,
      before: snapshot(row),
      now,
    }),
  ]);
  return c.json({
    ok: true,
    auditId: await latestAuditId(db, { action: 'day_note.delete', targetType: 'day_note', targetId: row.id, staffId: staff.id }),
  });
});

// ---- 操作ログから元に戻す(A-15) ----

registerUndo('day_note.create', async (db, log, ctx) => {
  const row = await findNote(db, Number(log.target_id));
  if (row.deleted_at) throw errors.conflict('day_note_changed', 'このメモは、もう消してあります。画面を読み込み直してください。');
  await db.prepare('UPDATE day_notes SET deleted_at = ? WHERE id = ?').bind(toJstIso(ctx.now), row.id).run();
});

registerUndo('day_note.update', async (db, log, ctx) => {
  const row = await findNote(db, Number(log.target_id));
  const before = JSON.parse(log.before_value ?? '{}') as { body: string };
  const after = JSON.parse(log.after_value ?? '{}') as { body: string };
  if (row.deleted_at) throw errors.conflict('day_note_changed', 'このメモは、もう消してあります。先に消したことを元に戻してください。');
  if (row.body !== after.body) {
    throw errors.conflict('day_note_changed', 'このメモは、そのあとにまた直されています。メモの画面で直してください。');
  }
  await db
    .prepare('UPDATE day_notes SET body = ?, updated_by_staff_id = ?, updated_at = ? WHERE id = ?')
    .bind(before.body, ctx.staffId, toJstIso(ctx.now), row.id)
    .run();
});

registerUndo('day_note.delete', async (db, log) => {
  const row = await findNote(db, Number(log.target_id));
  if (!row.deleted_at) throw errors.conflict('day_note_changed', 'このメモは、もう元に戻っています。画面を読み込み直してください。');
  await db.prepare('UPDATE day_notes SET deleted_at = NULL WHERE id = ?').bind(row.id).run();
});

// 操作ログの画面に出す、変更の中身(「10月29日「午後から雨」」)
const md = (ymd: string) => {
  const [, m, d] = ymd.split('-').map(Number);
  return `${m}月${d}日`;
};
const describe = (n: { date?: string; body?: string } | null) => (n?.date && n.body ? `${md(n.date)}「${firstLine(n.body, 30)}」` : null);
registerAuditDetail('day_note.create', (_b, a) => describe(a));
registerAuditDetail('day_note.delete', (b) => describe(b));
registerAuditDetail('day_note.update', (b, a) => (b && a ? `${describe(b)} → 「${firstLine(a.body ?? '', 30)}」` : null));
