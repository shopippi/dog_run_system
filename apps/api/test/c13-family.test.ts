import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { addFamily, call, checkin, dog, registerUser } from './helpers';

const PAPA = 'U001:パパ';
const MAMA = 'U002:ママ';

describe('C-13 家族の一覧と、自分が抜ける', () => {
  it('おうちの家族を、参加した順に返す(自分かどうか・参加日・参加方法)', async () => {
    const r = await registerUser(PAPA);
    await addFamily(r.memberNo, 'U002', 'ママ');
    await registerUser('U900:よその人');
    const res = await call('/api/family', { user: MAMA });
    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(2);
    // addFamily は 2026-01-01 に参加した扱い
    expect(res.body.members[0]).toMatchObject({ name: 'ママ', isMe: true, joinedAt: '2026-01-01T00:00:00+09:00', joinMethod: 'invite' });
    expect(res.body.members[1]).toMatchObject({ name: 'パパ', isMe: false, joinMethod: 'register' });
  });

  it('抜けると家族の一覧から外れ、ポイント・来場・犬はおうちに残る。操作ログに残る', async () => {
    const r = await registerUser(PAPA);
    await addFamily(r.memberNo, 'U002', 'ママ');
    await checkin(MAMA, [r.dogs[0]!.id], { now: '2026-10-28T01:00:00Z' });
    const res = await call('/api/family/leave', { user: MAMA, method: 'POST', now: '2026-10-29T01:00:00Z' });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare("SELECT status, left_at FROM family_members WHERE line_user_id = 'U002'").first();
    expect(row).toEqual({ status: 'left', left_at: '2026-10-29T10:00:00+09:00' });
    const list = await call('/api/family', { user: PAPA });
    expect(list.body.members.map((m: { name: string }) => m.name)).toEqual(['パパ']);
    const me = await call('/api/me', { user: PAPA });
    expect(me.body.card.balance).toBe(1);
    expect(me.body.card.dogs).toHaveLength(1);
    const visits = await call('/api/me/visits', { user: PAPA });
    expect(visits.body.visits).toHaveLength(1);

    const log = await env.DB.prepare("SELECT actor_type, action, target_type, before_value, after_value FROM audit_log WHERE action = 'family.leave'").all();
    expect(log.results).toHaveLength(1);
    expect(log.results[0]).toMatchObject({ actor_type: 'member', target_type: 'family_member' });
    expect(JSON.parse(log.results[0]!.before_value as string)).toMatchObject({ status: 'active', memberNo: r.memberNo });
  });

  it('抜けたあとは未登録の扱いになり、新しいおうちとして登録し直せる(会員IDは新しく発行)', async () => {
    const r = await registerUser(PAPA);
    await addFamily(r.memberNo, 'U002', 'ママ');
    await call('/api/family/leave', { user: MAMA, method: 'POST' });

    const me = await call('/api/me', { user: MAMA });
    expect(me.body.registered).toBe(false);
    expect((await call('/api/family', { user: MAMA })).status).toBe(409);
    const again = await registerUser(MAMA, [dog('モモ')]);
    expect(again.memberNo).not.toBe(r.memberNo);
    const me2 = await call('/api/me', { user: MAMA });
    expect(me2.body).toMatchObject({ registered: true, household: { memberNo: again.memberNo }, card: { balance: 0 } });
    const rows = await env.DB.prepare("SELECT status FROM family_members WHERE line_user_id = 'U002' ORDER BY id").all();
    expect(rows.results.map((x) => x.status)).toEqual(['left', 'active']);
  });

  it('最後の1人は抜けられない(退会は受付で)', async () => {
    await registerUser(PAPA);
    const res = await call('/api/family/leave', { user: PAPA, method: 'POST' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('last_member');
    expect(res.body.error.message).toMatch(/退会はできません/);
    expect(res.body.error.message).toMatch(/受付にお知らせください/);
    const row = await env.DB.prepare('SELECT status FROM family_members').first();
    expect(row).toEqual({ status: 'active' });
    const log = await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_log').first<{ n: number }>();
    expect(log!.n).toBe(0);
  });

  it('2人のおうちで1人が抜けたら、残った1人は抜けられない(境界値)', async () => {
    const r = await registerUser(PAPA);
    await addFamily(r.memberNo, 'U002', 'ママ');
    expect((await call('/api/family/leave', { user: PAPA, method: 'POST' })).status).toBe(200);
    expect((await call('/api/family/leave', { user: MAMA, method: 'POST' })).status).toBe(409);
  });

  it('未登録の人は 409、ログインがなければ 401', async () => {
    expect((await call('/api/family', { user: PAPA })).status).toBe(409);
    expect((await call('/api/family/leave', { user: PAPA, method: 'POST' })).status).toBe(409);
    expect((await call('/api/family')).status).toBe(401);
  });
});
