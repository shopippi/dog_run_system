import {
  staffCreateSchema,
  staffPasswordResetSchema,
  staffPatchSchema,
  toJstIso,
  type AdminStaff,
  type AdminStaffResponse,
  type StaffPasswordResult,
} from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { hashPassword } from '../../lib/password';
import { requireRole } from '../../lib/staff-auth';
import { parseJson } from '../../lib/validate';
import { auditStatement } from '../../services/audit';
import { registerUndo } from '../../services/undo';

// A-13 スタッフの管理(M-14)
// - 追加(名前・メール・役割・初期パスワード)、停止・再開、パスワードの再発行
// - 製作者(developer)の役割は管理画面からは作れない(docs/deploy.md のコマンドで作る)
// - 自分自身は停止できない。停止したら、そのスタッフのログインの印(staff_sessions)をすぐに無効にする
// - 操作ログにパスワードは残さない
// 注意: このファイルのルートは管理画面の API 全体に足されるので、use('*') で権限を付けない。ルートごとに付ける。
export const staffRoutes = new Hono<AppEnv>();

type Row = {
  id: number;
  name: string;
  email: string;
  role: AdminStaff['role'];
  status: AdminStaff['status'];
  last_login_at: string | null;
  created_at: string;
  locked_until: string | null;
};

async function listAll(db: D1Database, meId: number, now: Date): Promise<AdminStaffResponse> {
  const { results } = await db
    .prepare(
      `SELECT id, name, email, role, status, last_login_at, created_at, locked_until FROM staff_users
        ORDER BY status = 'suspended', CASE role WHEN 'admin' THEN 0 WHEN 'staff' THEN 1 ELSE 2 END, id`,
    )
    .all<Row>();
  const nowIso = toJstIso(now);
  return {
    staff: results.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      status: r.status,
      lastLoginAt: r.last_login_at,
      createdAt: r.created_at,
      locked: !!r.locked_until && r.locked_until > nowIso,
      isMe: r.id === meId,
    })),
  };
}

async function findStaff(db: D1Database, id: number): Promise<Row> {
  const row = await db
    .prepare('SELECT id, name, email, role, status, last_login_at, created_at, locked_until FROM staff_users WHERE id = ?')
    .bind(id)
    .first<Row>();
  if (!row) throw errors.notFound('そのスタッフが見つかりませんでした。画面を読み込み直してください。');
  return row;
}

/** ログインの印をすべて無効にする(停止したとき・パスワードを再発行したとき) */
const revokeSessions = (db: D1Database, staffId: number, nowIso: string) =>
  db.prepare('UPDATE staff_sessions SET revoked_at = ? WHERE staff_id = ? AND revoked_at IS NULL').bind(nowIso, staffId);

const setStatus = (db: D1Database, staffId: number, status: AdminStaff['status'], nowIso: string) =>
  db.prepare('UPDATE staff_users SET status = ?, updated_at = ? WHERE id = ?').bind(status, nowIso, staffId);

/** 読み間違えやすい文字(0 と O、1 と l など)を除いた12文字のパスワード */
function randomPassword(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const limit = 256 - (256 % chars.length);
  let out = '';
  while (out.length < 12) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < limit && out.length < 12) out += chars[b % chars.length];
    }
  }
  return out;
}

const roleOf = (row: Row) => ({ name: row.name, email: row.email, role: row.role });

// スタッフの一覧。管理者(製作者は見るだけ)
staffRoutes.get('/staff', requireRole('admin'), async (c) => c.json(await listAll(c.env.DB, c.get('staff').id, c.get('now'))));

// スタッフを追加する(受付スタッフか管理者)
staffRoutes.post('/staff', requireRole('admin'), async (c) => {
  // 製作者の役割は、ここでは作れない(画面にも出さない)
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    raw = null;
  }
  if (raw && typeof raw === 'object' && (raw as { role?: unknown }).role === 'developer') {
    throw errors.forbidden('製作者のアカウントは、管理画面からは作れません。製作者に依頼してください。');
  }
  const input = staffCreateSchema.safeParse(raw);
  if (!input.success) {
    const message = input.error.issues[0]?.message ?? '';
    throw errors.badRequest(/[ぁ-んァ-ヶ一-龠]/.test(message) ? message : '入力された内容を確認できませんでした。入力をやり直してください。');
  }
  const { name, email, role, password } = input.data;
  const db = c.env.DB;
  const exists = await db.prepare('SELECT id FROM staff_users WHERE email = ?').bind(email).first();
  if (exists) throw errors.conflict('staff_exists', 'このメールアドレスのスタッフは、もう登録されています。一覧から探してください。');
  const now = c.get('now');
  const nowIso = toJstIso(now);
  const hash = await hashPassword(password);
  const res = await db.batch([
    db
      .prepare(
        `INSERT INTO staff_users (email, name, password_hash, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      )
      .bind(email, name, hash, role, nowIso, nowIso),
    auditStatement(db, {
      staffId: c.get('staff').id,
      action: 'staff.create',
      targetType: 'staff',
      targetId: { sql: 'last_insert_rowid()' },
      after: { name, email, role },
      now,
    }),
  ]);
  return c.json({ id: res[0]!.meta.last_row_id, ...(await listAll(db, c.get('staff').id, now)) }, 201);
});

// 停止・再開。自分自身は停止できない。停止したら、ログイン中の画面もすぐに使えなくなる
staffRoutes.patch('/staff/:id', requireRole('admin'), async (c) => {
  const { status } = await parseJson(c, staffPatchSchema);
  const db = c.env.DB;
  const me = c.get('staff');
  const row = await findStaff(db, Number(c.req.param('id')) || 0);
  if (row.id === me.id && status === 'suspended') {
    throw errors.badRequest('自分のアカウントは停止できません。ほかの管理者に依頼してください。');
  }
  const now = c.get('now');
  if (row.status !== status) {
    const nowIso = toJstIso(now);
    await db.batch([
      setStatus(db, row.id, status, nowIso),
      ...(status === 'suspended' ? [revokeSessions(db, row.id, nowIso)] : []),
      auditStatement(db, {
        staffId: me.id,
        action: 'staff.status',
        targetType: 'staff',
        targetId: row.id,
        before: { ...roleOf(row), status: row.status },
        after: { ...roleOf(row), status },
        now,
      }),
    ]);
  }
  return c.json(await listAll(db, me.id, now));
});

// パスワードの再発行。新しいパスワードを入れるか、ランダムに作る(作ったときだけ1回だけ返す)。
// ロックも解除し、ほかの端末のログインは無効にする(自分のときは、いまの端末はそのまま)
staffRoutes.post('/staff/:id/password', requireRole('admin'), async (c) => {
  const input = await parseJson(c, staffPasswordResetSchema);
  const db = c.env.DB;
  const me = c.get('staff');
  const row = await findStaff(db, Number(c.req.param('id')) || 0);
  if (row.role === 'developer') {
    throw errors.forbidden('製作者のパスワードは、管理画面からは変えられません。製作者に依頼してください。');
  }
  const generated = input.password === undefined ? randomPassword() : null;
  const password = input.password ?? generated!;
  const now = c.get('now');
  const nowIso = toJstIso(now);
  const statements = [
    db
      .prepare('UPDATE staff_users SET password_hash = ?, failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?')
      .bind(await hashPassword(password), nowIso, row.id),
    auditStatement(db, {
      staffId: me.id,
      action: 'staff.password_reset',
      targetType: 'staff',
      targetId: row.id,
      after: { ...roleOf(row), generated: generated !== null },
      now,
    }),
  ];
  if (row.id !== me.id) statements.push(revokeSessions(db, row.id, nowIso));
  await db.batch(statements);
  const body: StaffPasswordResult = { password: generated };
  return c.json(body);
});

// ---- 操作ログから元に戻す(A-15) ----

registerUndo('staff.status', async (db, log, ctx) => {
  const row = await findStaff(db, Number(log.target_id));
  const before = JSON.parse(log.before_value ?? '{}') as { status: AdminStaff['status'] };
  const after = JSON.parse(log.after_value ?? '{}') as { status: AdminStaff['status'] };
  if (row.status !== after.status) {
    throw errors.conflict('staff_changed', 'このスタッフは、そのあとにまた停止・再開されています。スタッフの画面で直してください。');
  }
  if (before.status === 'suspended' && row.id === ctx.staffId) {
    throw errors.badRequest('自分のアカウントは停止できません。ほかの管理者に依頼してください。');
  }
  const nowIso = toJstIso(ctx.now);
  await db.batch([
    setStatus(db, row.id, before.status, nowIso),
    ...(before.status === 'suspended' ? [revokeSessions(db, row.id, nowIso)] : []),
  ]);
});

// 追加の取り消しは、削除ではなく停止にする
registerUndo('staff.create', async (db, log, ctx) => {
  const row = await findStaff(db, Number(log.target_id));
  if (row.id === ctx.staffId) throw errors.badRequest('自分のアカウントは停止できません。ほかの管理者に依頼してください。');
  const nowIso = toJstIso(ctx.now);
  await db.batch([setStatus(db, row.id, 'suspended', nowIso), revokeSessions(db, row.id, nowIso)]);
});
