import { LOGIN_LOCK_MINUTES, LOGIN_MAX_FAILURES, loginSchema, toJstIso, type StaffMe } from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { AppError, errors } from '../../lib/errors';
import { verifyPassword } from '../../lib/password';
import { endSession, lockUntil, requireStaff, startSession } from '../../lib/staff-auth';
import { parseJson } from '../../lib/validate';

export const authRoutes = new Hono<AppEnv>();

const wrongLogin = () =>
  new AppError(401, 'login_failed', 'メールアドレスかパスワードが違います。確かめて、もう一度入力してください。');

// ログイン(S-01)。5回まちがえたら15分ロックする(15.2)
authRoutes.post('/login', async (c) => {
  const { email, password } = await parseJson(c, loginSchema);
  const db = c.env.DB;
  const now = c.get('now');
  const nowIso = toJstIso(now);
  const user = await db
    .prepare('SELECT id, password_hash, status, failed_login_count, locked_until FROM staff_users WHERE email = ?')
    .bind(email)
    .first<{ id: number; password_hash: string; status: string; failed_login_count: number; locked_until: string | null }>();

  if (!user) {
    // メールアドレスが登録されているかどうかは、画面に出さない
    await verifyPassword(password, 'pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    throw wrongLogin();
  }
  if (user.locked_until && user.locked_until > nowIso) {
    throw new AppError(
      429,
      'locked',
      `パスワードを${LOGIN_MAX_FAILURES}回まちがえたため、${user.locked_until.slice(11, 16)}までログインできません。その時刻を過ぎてから、もう一度お試しください。`,
    );
  }
  if (!(await verifyPassword(password, user.password_hash))) {
    const failures = user.failed_login_count + 1;
    const locked = failures >= LOGIN_MAX_FAILURES;
    await db
      .prepare('UPDATE staff_users SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?')
      .bind(locked ? 0 : failures, locked ? lockUntil(now, LOGIN_LOCK_MINUTES) : null, nowIso, user.id)
      .run();
    throw wrongLogin();
  }
  if (user.status !== 'active') {
    throw errors.forbidden('このアカウントは停止されています。管理者に確認してください。');
  }
  await db
    .prepare('UPDATE staff_users SET failed_login_count = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?')
    .bind(nowIso, nowIso, user.id)
    .run();
  await startSession(c, user.id);
  return c.json({ ok: true });
});

authRoutes.post('/logout', requireStaff, async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

// ログイン中の利用者
authRoutes.get('/me', requireStaff, (c) => {
  const body: StaffMe = c.get('staff');
  return c.json(body);
});
