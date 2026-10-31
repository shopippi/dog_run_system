import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { adminCall, createStaff, login } from './helpers';

const T0 = '2026-10-28T01:00:00Z';

describe('S-01 ログイン', () => {
  it('メールアドレスとパスワードでログインし、30日間ログインを保つクッキーを受け取る', async () => {
    await createStaff('owner@example.com', 'admin');
    const res = await adminCall('/admin/api/login', { body: { email: 'Owner@Example.com ', password: 'password-1234' }, now: T0 });
    expect(res.status).toBe(200);
    expect(res.cookie).toMatch(/^dr_sid=[0-9a-f]{64}$/);

    const me = await adminCall('/admin/api/me', { cookie: res.cookie, now: T0 });
    expect(me.body).toEqual({ id: 1, name: '管理者', email: 'owner@example.com', role: 'admin' });

    const s = await env.DB.prepare('SELECT id, expires_at FROM staff_sessions').first<{ id: string; expires_at: string }>();
    expect(s?.expires_at).toBe('2026-11-27T10:00:00+09:00');
    // データベースにはトークンそのものではなくハッシュを保存する
    expect(res.cookie).not.toContain(s!.id);
  });

  it('クッキーは HttpOnly・Secure・SameSite=Lax・/admin だけ', async () => {
    await createStaff('owner@example.com', 'admin');
    const { SELF } = await import('cloudflare:test');
    const res = await SELF.fetch('https://dogrun.test/admin/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dr-admin': '1' },
      body: JSON.stringify({ email: 'owner@example.com', password: 'password-1234' }),
    });
    const sc = res.headers.get('set-cookie')!;
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/Secure/);
    expect(sc).toMatch(/SameSite=Lax/);
    expect(sc).toMatch(/Path=\/admin/);
    expect(sc).toMatch(/Max-Age=2592000/);
  });

  it('パスワードが違うと 401。メールアドレスがない場合も同じ表示', async () => {
    await createStaff('owner@example.com', 'admin');
    const wrong = await adminCall('/admin/api/login', { body: { email: 'owner@example.com', password: 'nope' } });
    const none = await adminCall('/admin/api/login', { body: { email: 'none@example.com', password: 'nope' } });
    expect(wrong.status).toBe(401);
    expect(none.status).toBe(401);
    expect(wrong.body.error.message).toBe(none.body.error.message);
    expect(wrong.body.error.message).toMatch(/もう一度入力して/);
  });

  it('5回まちがえたら15分ロックし、15分たてばログインできる', async () => {
    await createStaff('owner@example.com', 'admin');
    for (let i = 0; i < 5; i++) {
      await adminCall('/admin/api/login', { body: { email: 'owner@example.com', password: 'nope' }, now: T0 });
    }
    const locked = await adminCall('/admin/api/login', {
      body: { email: 'owner@example.com', password: 'password-1234' },
      now: '2026-10-28T01:14:59Z',
    });
    expect(locked.status).toBe(429);
    expect(locked.body.error.message).toMatch(/10:15までログインできません/);

    const ok = await adminCall('/admin/api/login', {
      body: { email: 'owner@example.com', password: 'password-1234' },
      now: '2026-10-28T01:15:01Z',
    });
    expect(ok.status).toBe(200);
  });

  it('4回まちがえても、正しく入れれば数え直す', async () => {
    await createStaff('owner@example.com', 'admin');
    for (let i = 0; i < 4; i++) {
      await adminCall('/admin/api/login', { body: { email: 'owner@example.com', password: 'nope' } });
    }
    await login('owner@example.com');
    const u = await env.DB.prepare('SELECT failed_login_count FROM staff_users').first();
    expect(u).toEqual({ failed_login_count: 0 });
  });

  it('ログアウトすると、そのクッキーは使えなくなる', async () => {
    await createStaff('owner@example.com', 'admin');
    const cookie = await login('owner@example.com');
    expect((await adminCall('/admin/api/logout', { cookie, method: 'POST' })).status).toBe(200);
    const me = await adminCall('/admin/api/me', { cookie });
    expect(me.status).toBe(401);
    expect(me.body.error.message).toMatch(/もう一度ログイン/);
  });

  it('30日使わなければログインが切れる。使っていれば延びる', async () => {
    await createStaff('owner@example.com', 'admin');
    const cookie = await login('owner@example.com', undefined, T0);
    // 20日後に使うと、そこから30日に延びる
    expect((await adminCall('/admin/api/me', { cookie, now: '2026-11-17T01:00:00Z' })).status).toBe(200);
    expect((await adminCall('/admin/api/me', { cookie, now: '2026-12-16T01:00:00Z' })).status).toBe(200);
    expect((await adminCall('/admin/api/me', { cookie, now: '2027-01-16T01:00:00Z' })).status).toBe(401);
  });

  it('停止したスタッフは、ログイン中でもすぐに使えなくなる', async () => {
    await createStaff('staff@example.com', 'staff');
    const cookie = await login('staff@example.com');
    await env.DB.prepare("UPDATE staff_users SET status = 'suspended'").run();
    expect((await adminCall('/admin/api/me', { cookie })).status).toBe(401);
    const again = await adminCall('/admin/api/login', { body: { email: 'staff@example.com', password: 'password-1234' } });
    expect(again.status).toBe(403);
  });

  it('ログインしていないと管理画面向けの API は 401', async () => {
    expect((await adminCall('/admin/api/me')).status).toBe(401);
    expect((await adminCall('/admin/api/me', { cookie: 'dr_sid=deadbeef' })).status).toBe(401);
  });

  it('変更系の操作は x-dr-admin ヘッダーがないと 403(ほかのサイトからの送信を防ぐ)', async () => {
    await createStaff('owner@example.com', 'admin');
    const cookie = await login('owner@example.com');
    const res = await adminCall('/admin/api/logout', { cookie, method: 'POST', noAdminHeader: true });
    expect(res.status).toBe(403);
  });

  it('製作者のアカウントは、閲覧はできるが変更系の API はすべて 403(19.2)', async () => {
    await createStaff('dev@example.com', 'developer');
    const cookie = await login('dev@example.com');
    expect((await adminCall('/admin/api/me', { cookie })).status).toBe(200);
    const res = await adminCall('/admin/api/anything', { cookie, method: 'POST', body: {} });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/製作者のアカウントは見るだけ/);
    // ログアウトはできる
    expect((await adminCall('/admin/api/logout', { cookie, method: 'POST' })).status).toBe(200);
  });
});
