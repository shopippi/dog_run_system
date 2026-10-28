import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { call, registerUser } from './helpers';

const PAPA = 'U001:パパ';

describe('C-11 家族の招待', () => {
  it('招待を作ると、推測できないコードと24時間後の期限を返す', async () => {
    await registerUser(PAPA);
    const res = await call('/api/invites', { user: PAPA, method: 'POST', now: '2026-10-28T01:00:00Z' });
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(res.body.expiresAt).toBe('2026-10-29T10:00:00+09:00');
    const row = await env.DB.prepare('SELECT kind, created_by_member_id IS NOT NULL AS by_member, used_at FROM invites').first();
    expect(row).toEqual({ kind: 'family', by_member: 1, used_at: null });
  });

  it('押すたびに別の招待を作る', async () => {
    await registerUser(PAPA);
    const a = await call('/api/invites', { user: PAPA, method: 'POST' });
    const b = await call('/api/invites', { user: PAPA, method: 'POST' });
    expect(a.body.code).not.toBe(b.body.code);
  });

  it('有効時間は設定で変えられる', async () => {
    await env.DB.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES ('invite_ttl_hours', '48', '2026-01-01T00:00:00+09:00')",
    ).run();
    await registerUser(PAPA);
    const res = await call('/api/invites', { user: PAPA, method: 'POST', now: '2026-10-28T01:00:00Z' });
    expect(res.body.expiresAt).toBe('2026-10-30T10:00:00+09:00');
  });

  it('未登録の人は招待を作れない', async () => {
    const res = await call('/api/invites', { user: PAPA, method: 'POST' });
    expect(res.status).toBe(409);
  });
});
