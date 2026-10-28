import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { getUndo, type AuditRow } from '../src/services/undo';
import '../src/routes/admin/staff';
import { adminCall, createStaff, login } from './helpers';

async function as(role: 'staff' | 'admin' | 'developer') {
  await createStaff(`${role}@example.com`, role);
  return login(`${role}@example.com`);
}
const lastLog = () => env.DB.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 1').first<AuditRow>();
const newStaff = (cookie: string, body: Record<string, unknown>) => adminCall('/admin/api/staff', { cookie, body });
const tryLogin = (email: string, password: string) => adminCall('/admin/api/login', { body: { email, password } });

describe('A-13 スタッフの管理', () => {
  it('受付スタッフを追加すると、そのメールアドレスとパスワードでログインできる。操作ログにパスワードは残らない', async () => {
    const cookie = await as('admin');
    const res = await newStaff(cookie, { name: '山田', email: ' Yamada@Example.com ', role: 'staff', password: 'first-pass-123' });
    expect(res.status).toBe(201);
    const added = res.body.staff.find((s: { id: number }) => s.id === res.body.id);
    expect(added).toMatchObject({ name: '山田', email: 'yamada@example.com', role: 'staff', status: 'active', isMe: false });
    expect(res.body.staff.find((s: { isMe: boolean }) => s.isMe)).toMatchObject({ email: 'admin@example.com' });

    expect((await tryLogin('yamada@example.com', 'first-pass-123')).status).toBe(200);
    const log = (await lastLog())!;
    expect(log).toMatchObject({ action: 'staff.create', target_id: String(res.body.id) });
    const all = await env.DB.prepare('SELECT before_value, after_value FROM audit_log').all();
    expect(JSON.stringify(all.results)).not.toContain('first-pass-123');
  });

  it('入力のチェック: パスワードは10文字以上(境界値)、同じメールアドレスは 409、製作者は作れない', async () => {
    const cookie = await as('admin');
    const short = await newStaff(cookie, { name: 'A', email: 'a@example.com', role: 'staff', password: '123456789' });
    expect(short.status).toBe(400);
    expect(short.body.error.message).toBe('パスワードは10文字以上にしてください。');
    expect((await newStaff(cookie, { name: 'A', email: 'a@example.com', role: 'staff', password: '1234567890' })).status).toBe(201);
    const dup = await newStaff(cookie, { name: 'B', email: 'A@example.com', role: 'admin', password: '1234567890' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toMatch(/もう登録されています/);
    const dev = await newStaff(cookie, { name: 'C', email: 'c@example.com', role: 'developer', password: '1234567890' });
    expect(dev.status).toBe(403);
    expect(dev.body.error.message).toMatch(/製作者のアカウントは、管理画面からは作れません/);
    expect((await newStaff(cookie, { name: 'D', email: 'not-mail', role: 'staff', password: '1234567890' })).body.error.message).toBe(
      'メールアドレスの形を確かめてください。',
    );
  });

  it('停止すると、ログイン中の画面もすぐに使えなくなり、ログインもできない。再開すると戻る', async () => {
    const cookie = await as('admin');
    const staffCookie = await as('staff');
    expect((await adminCall('/admin/api/today', { cookie: staffCookie })).status).toBe(200);
    const staffId = 2;

    const res = await adminCall(`/admin/api/staff/${staffId}`, { cookie, method: 'PATCH', body: { status: 'suspended' } });
    expect(res.status).toBe(200);
    expect(res.body.staff.find((s: { id: number }) => s.id === staffId)).toMatchObject({ status: 'suspended' });
    expect((await adminCall('/admin/api/today', { cookie: staffCookie })).status).toBe(401);
    const revoked = await env.DB.prepare('SELECT COUNT(*) AS n FROM staff_sessions WHERE staff_id = ? AND revoked_at IS NULL').bind(staffId).first();
    expect(revoked).toEqual({ n: 0 });
    expect((await tryLogin('staff@example.com', 'password-1234')).status).toBe(403);
    expect(await lastLog()).toMatchObject({ action: 'staff.status', target_id: String(staffId) });

    await adminCall(`/admin/api/staff/${staffId}`, { cookie, method: 'PATCH', body: { status: 'active' } });
    expect((await tryLogin('staff@example.com', 'password-1234')).status).toBe(200);
  });

  it('自分自身は停止できない', async () => {
    const cookie = await as('admin');
    const res = await adminCall('/admin/api/staff/1', { cookie, method: 'PATCH', body: { status: 'suspended' } });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/自分のアカウントは停止できません/);
  });

  it('パスワードの再発行: 入れたパスワードか、ランダムに作ったもの(1回だけ返す)。ロックも解除し、古いログインは無効になる', async () => {
    const cookie = await as('admin');
    const staffCookie = await as('staff');
    // 5回まちがえてロックされた状態
    for (let i = 0; i < 5; i++) await tryLogin('staff@example.com', 'wrong-password');
    expect((await tryLogin('staff@example.com', 'password-1234')).status).toBe(429);
    expect((await adminCall('/admin/api/staff', { cookie })).body.staff.find((s: { id: number }) => s.id === 2).locked).toBe(true);

    const set = await adminCall('/admin/api/staff/2/password', { cookie, body: { password: 'new-pass-0001' } });
    expect(set.status).toBe(200);
    expect(set.body).toEqual({ password: null });
    expect((await adminCall('/admin/api/today', { cookie: staffCookie })).status).toBe(401);
    expect((await tryLogin('staff@example.com', 'new-pass-0001')).status).toBe(200);

    const gen = await adminCall('/admin/api/staff/2/password', { cookie, body: {} });
    expect(gen.body.password).toMatch(/^[a-zA-Z2-9]{12}$/);
    expect((await tryLogin('staff@example.com', gen.body.password)).status).toBe(200);
    expect((await tryLogin('staff@example.com', 'new-pass-0001')).status).toBe(401);
    const all = await env.DB.prepare('SELECT after_value FROM audit_log WHERE action = ?').bind('staff.password_reset').all();
    expect(all.results).toHaveLength(2);
    expect(JSON.stringify(all.results)).not.toContain(gen.body.password);

    // 自分のパスワードを変えても、いまの画面はそのまま使える
    expect((await adminCall('/admin/api/staff/1/password', { cookie, body: { password: 'admin-pass-0001' } })).status).toBe(200);
    expect((await adminCall('/admin/api/staff', { cookie })).status).toBe(200);
    expect((await adminCall('/admin/api/staff/1/password', { cookie, body: { password: 'short' } })).status).toBe(400);
  });

  it('製作者のパスワードは管理画面から変えられない', async () => {
    const cookie = await as('admin');
    await createStaff('developer@example.com', 'developer');
    expect((await adminCall('/admin/api/staff/2/password', { cookie, body: {} })).status).toBe(403);
  });

  it('停止は操作ログから元に戻せる。追加の取り消しは停止にする', async () => {
    const cookie = await as('admin');
    await createStaff('staff@example.com', 'staff');
    await adminCall('/admin/api/staff/2', { cookie, method: 'PATCH', body: { status: 'suspended' } });
    await getUndo('staff.status')!(env.DB, (await lastLog())!, { staffId: 1, now: new Date() });
    expect((await tryLogin('staff@example.com', 'password-1234')).status).toBe(200);

    const res = await newStaff(cookie, { name: '佐藤', email: 'sato@example.com', role: 'staff', password: '1234567890' });
    await getUndo('staff.create')!(env.DB, (await lastLog())!, { staffId: 1, now: new Date() });
    const row = (await adminCall('/admin/api/staff', { cookie })).body.staff.find((s: { id: number }) => s.id === res.body.id);
    expect(row.status).toBe('suspended');
  });

  it('受付スタッフは 403。製作者は一覧を見られるが、変更は 403', async () => {
    const staff = await as('staff');
    expect((await adminCall('/admin/api/staff', { cookie: staff })).status).toBe(403);
    expect((await newStaff(staff, { name: 'X', email: 'x@example.com', role: 'admin', password: '1234567890' })).status).toBe(403);
    const dev = await as('developer');
    const list = await adminCall('/admin/api/staff', { cookie: dev });
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain('password');
    expect((await newStaff(dev, { name: 'X', email: 'x@example.com', role: 'staff', password: '1234567890' })).status).toBe(403);
    expect((await adminCall('/admin/api/staff/1', { cookie: dev, method: 'PATCH', body: { status: 'suspended' } })).status).toBe(403);
    expect((await adminCall('/admin/api/staff/1/password', { cookie: dev, body: {} })).status).toBe(403);
  });
});
