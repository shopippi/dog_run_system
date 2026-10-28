import { SESSION_DAYS, addMinutes, toJstIso, type StaffRole } from '@dr/shared';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';
import { errors } from './errors';
import { newSessionToken, sha256Hex } from './password';

export const SESSION_COOKIE = 'dr_sid';
const DAY_MS = 24 * 60 * 60 * 1000;

/** ログインの印を作り、クッキーに入れる(30日間有効)。 */
export async function startSession(c: Context<AppEnv>, staffId: number) {
  const token = newSessionToken();
  const now = c.get('now');
  const expires = new Date(now.getTime() + SESSION_DAYS * DAY_MS);
  await c.env.DB.prepare(
    'INSERT INTO staff_sessions (id, staff_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(await sha256Hex(token), staffId, toJstIso(now), toJstIso(expires), (c.req.header('user-agent') ?? '').slice(0, 200))
    .run();
  setSessionCookie(c, token);
}

function setSessionCookie(c: Context<AppEnv>, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/admin',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function endSession(c: Context<AppEnv>) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await c.env.DB.prepare('UPDATE staff_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .bind(toJstIso(c.get('now')), await sha256Hex(token))
      .run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/admin', secure: true });
}

/**
 * 管理画面向け API の認証(S-01)。
 * - ログインの印(クッキー)を毎回データベースで確かめる。ログアウト・スタッフの停止はすぐに効く
 * - 使うたびに期限を30日先へ延ばす(1日に1回だけ書き込む)
 * - 変更系の操作には x-dr-admin ヘッダーを求め、ほかのサイトからの送信を防ぐ
 * - 製作者のアカウントは閲覧のみ。変更系の操作はすべて 403(3.2)
 */
export const requireStaff = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) throw notLoggedIn();
  const id = await sha256Hex(token);
  const now = c.get('now');
  const nowIso = toJstIso(now);
  const row = await c.env.DB.prepare(
    `SELECT s.expires_at, u.id, u.email, u.name, u.role, u.status
       FROM staff_sessions s JOIN staff_users u ON u.id = s.staff_id
      WHERE s.id = ? AND s.revoked_at IS NULL`,
  )
    .bind(id)
    .first<{ expires_at: string; id: number; email: string; name: string; role: StaffRole; status: string }>();
  if (!row || row.expires_at < nowIso || row.status !== 'active') throw notLoggedIn();

  if (new Date(row.expires_at).getTime() - now.getTime() < (SESSION_DAYS - 1) * DAY_MS) {
    await c.env.DB.prepare('UPDATE staff_sessions SET expires_at = ? WHERE id = ?')
      .bind(toJstIso(new Date(now.getTime() + SESSION_DAYS * DAY_MS)), id)
      .run();
    setSessionCookie(c, token);
  }

  const method = c.req.method;
  const isWrite = method !== 'GET' && method !== 'HEAD';
  if (isWrite && c.req.header('x-dr-admin') !== '1') {
    throw errors.forbidden('画面を読み込み直して、もう一度お試しください。');
  }
  if (isWrite && row.role === 'developer' && !c.req.path.endsWith('/logout')) {
    throw errors.forbidden('製作者のアカウントは見るだけです。変更は管理者のアカウントで行ってください。');
  }
  c.set('staff', { id: row.id, email: row.email, name: row.name, role: row.role });
  await next();
});

/** 役割を限る。製作者は閲覧(GET)だけ通す。 */
export function requireRole(...roles: StaffRole[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const staff = c.get('staff');
    const readOnlyDeveloper = staff.role === 'developer' && (c.req.method === 'GET' || c.req.method === 'HEAD');
    if (!roles.includes(staff.role) && !readOnlyDeveloper) throw errors.forbidden();
    await next();
  });
}

const notLoggedIn = () =>
  errors.unauthorized('ログインの期限が切れました。もう一度ログインしてください。');

export function lockUntil(now: Date, minutes: number) {
  return toJstIso(addMinutes(now, minutes));
}
