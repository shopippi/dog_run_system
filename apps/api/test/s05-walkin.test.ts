import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { adminCall, checkin, createStaff, login, registerUser } from './helpers';

const DAY1 = '2026-10-28T01:00:00Z';

async function cookieOf(role: 'staff' | 'admin' | 'developer') {
  await createStaff(`${role}@example.com`, role);
  return login(`${role}@example.com`);
}

describe('S-05 会員以外の入力', () => {
  it('頭数だけを記録し、今日の来場の集計に含める', async () => {
    const staff = await cookieOf('staff');
    const r = await registerUser('U001:パパ');
    await checkin('U001:パパ', [r.dogs[0]!.id], { now: DAY1 });
    const res = await adminCall('/admin/api/walkins', { cookie: staff, body: { dogCount: 2 }, now: DAY1 });
    expect(res.status).toBe(201);

    const today = await adminCall('/admin/api/today', { cookie: staff, now: DAY1 });
    expect(today.body.visits[0]).toMatchObject({ method: 'walkin', dogCount: 2, householdId: null, dogs: [] });
    expect(today.body.totals).toEqual({ groups: 2, memberDogs: 1, walkinDogs: 2, ticketsUsed: 0 });
  });

  it('同じ日に何組でも記録できる(会員以外は1日1回の制限なし)', async () => {
    const staff = await cookieOf('staff');
    await adminCall('/admin/api/walkins', { cookie: staff, body: { dogCount: 1 }, now: DAY1 });
    await adminCall('/admin/api/walkins', { cookie: staff, body: { dogCount: 1 }, now: DAY1 });
    const today = await adminCall('/admin/api/today', { cookie: staff, now: DAY1 });
    expect(today.body.totals.walkinDogs).toBe(2);
  });

  it('操作ログに残り、取り消しもできる', async () => {
    const staff = await cookieOf('staff');
    const res = await adminCall('/admin/api/walkins', { cookie: staff, body: { dogCount: 3 }, now: DAY1 });
    const log = await env.DB.prepare("SELECT target_id, after_value FROM audit_log WHERE action = 'visit.walkin'").first();
    expect(log).toEqual({ target_id: String(res.body.id), after_value: JSON.stringify({ dogCount: 3 }) });
    const c = await adminCall(`/admin/api/checkins/${res.body.id}/cancel`, { cookie: staff, body: { reason: '入力ミス' }, now: DAY1 });
    expect(c.status).toBe(200);
    const today = await adminCall('/admin/api/today', { cookie: staff, now: DAY1 });
    expect(today.body.totals.walkinDogs).toBe(0);
  });

  it('頭数は1〜30', async () => {
    const staff = await cookieOf('staff');
    expect((await adminCall('/admin/api/walkins', { cookie: staff, body: { dogCount: 0 } })).status).toBe(400);
    expect((await adminCall('/admin/api/walkins', { cookie: staff, body: { dogCount: 31 } })).status).toBe(400);
  });

  it('製作者は記録できない', async () => {
    const dev = await cookieOf('developer');
    expect((await adminCall('/admin/api/walkins', { cookie: dev, body: { dogCount: 1 } })).status).toBe(403);
  });
});
