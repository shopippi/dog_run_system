import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { call, dog, survey } from './helpers';

const PAPA = 'U001:パパ';
const MAMA = 'U002:ママ';

describe('C-01 初回登録', () => {
  it('LINE の IDトークンがないと 401', async () => {
    const res = await call('/api/me');
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/もう一度開いて/);
  });

  it('LINE が無効と答えた IDトークンは 401', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"error":"invalid_request"}', { status: 400 }));
    const res = await call('/api/me', { headers: { authorization: 'Bearer something' } });
    expect(res.status).toBe(401);
    expect(spy).toHaveBeenCalledWith('https://api.line.me/oauth2/v2.1/verify', expect.anything());
    spy.mockRestore();
  });

  it('LINE が有効と答えた IDトークンなら、そのユーザーとして扱う', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json({ sub: 'Ureal', name: '本物のユーザー' }, { status: 200 }));
    const res = await call('/api/me', { headers: { authorization: 'Bearer real.jwt.token' } });
    expect(res.status).toBe(200);
    expect(res.body.lineDisplayName).toBe('本物のユーザー');
    spy.mockRestore();
  });

  it('LINE につながらないときは 503 と、もう一度開くよう案内する', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    const res = await call('/api/me', { headers: { authorization: 'Bearer something' } });
    expect(res.status).toBe(503);
    expect(res.body.error.message).toMatch(/もう一度開いて/);
    spy.mockRestore();
  });

  it('未登録の LINE ユーザーには、未登録であることと規約の本文を返す', async () => {
    const res = await call('/api/me', { user: PAPA });
    expect(res.status).toBe(200);
    expect(res.body.registered).toBe(false);
    expect(res.body.lineDisplayName).toBe('パパ');
    expect(res.body.terms.termsText).toBeTruthy();
  });

  it('同意がないと登録できない', async () => {
    const res = await call('/api/register', { user: PAPA, body: { consent: false } });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/同意/);
  });

  it('登録すると DR-000001 形式の会員IDが連番で発行される', async () => {
    const a = await call('/api/register', { user: PAPA, body: { consent: true, dogs: [dog('アル')], survey: survey() } });
    expect(a.status).toBe(201);
    expect(a.body.memberNo).toBe('DR-000001');
    const b = await call('/api/register', { user: MAMA, body: { consent: true, dogs: [dog('アル')], survey: survey() } });
    expect(b.body.memberNo).toBe('DR-000002');

    const me = await call('/api/me', { user: PAPA });
    expect(me.body.registered).toBe(true);
    expect(me.body.household.memberNo).toBe('DR-000001');
  });

  it('同意した日時と、登録の方法を記録する', async () => {
    await call('/api/register', { user: PAPA, body: { consent: true, dogs: [dog('アル')], survey: survey() }, now: '2026-10-28T01:00:00Z' });
    const row = await env.DB.prepare('SELECT consented_at, join_method, line_display_name FROM family_members').first();
    expect(row).toEqual({ consented_at: '2026-10-28T10:00:00+09:00', join_method: 'register', line_display_name: 'パパ' });
  });

  it('同じ LINE アカウントは2回登録できない', async () => {
    await call('/api/register', { user: PAPA, body: { consent: true, dogs: [dog('アル')], survey: survey() } });
    const again = await call('/api/register', { user: PAPA, body: { consent: true, dogs: [dog('アル')], survey: survey() } });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_registered');
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM households').first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it('同時に登録しても、会員IDは重ならない', async () => {
    const users = Array.from({ length: 6 }, (_, i) => `U10${i}:ユーザー${i}`);
    const results = await Promise.all(users.map((user) => call('/api/register', { user, body: { consent: true, dogs: [dog('アル')], survey: survey() } })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const nos = results.map((r) => r.body.memberNo).sort();
    expect(nos).toEqual(['DR-000001', 'DR-000002', 'DR-000003', 'DR-000004', 'DR-000005', 'DR-000006']);
  });

  it('おうちから抜けた人は、新しいおうちとして登録し直せる', async () => {
    await call('/api/register', { user: PAPA, body: { consent: true, dogs: [dog('アル')], survey: survey() } });
    await env.DB.prepare("UPDATE family_members SET status = 'left'").run();
    const res = await call('/api/register', { user: PAPA, body: { consent: true, dogs: [dog('アル')], survey: survey() } });
    expect(res.status).toBe(201);
    expect(res.body.memberNo).toBe('DR-000002');
  });

  it('LINE の表示名が変わったら、次に開いたときに更新する', async () => {
    await call('/api/register', { user: PAPA, body: { consent: true, dogs: [dog('アル')], survey: survey() } });
    const me = await call('/api/me', { user: 'U001:パパ(新)' });
    expect(me.body.member.lineDisplayName).toBe('パパ(新)');
  });
});
