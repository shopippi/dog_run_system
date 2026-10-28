import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { adminCall, call, checkin, createStaff, dog, fakeJpeg, givePoints, login, registerUser } from './helpers';

const PAPA = 'U001:パパ';
const DAY1 = '2026-10-28T01:00:00Z';

async function setup() {
  await createStaff('admin@example.com', 'admin');
  await createStaff('staff@example.com', 'staff');
  await createStaff('dev@example.com', 'developer');
  return {
    admin: await login('admin@example.com'),
    staff: await login('staff@example.com'),
    dev: await login('dev@example.com'),
  };
}

describe('S-02 今日の来場', () => {
  it('時刻・犬の写真と名前・おうちの呼び名・無料券の使用を、新しい順に返す', async () => {
    const { staff } = await setup();
    const a = await registerUser(PAPA, [dog('アル'), dog('ニコ')]);
    const b = await registerUser('U002:ハナママ', [dog('ハナ')]);
    await givePoints(b.memberNo, 9);
    await checkin('U002:ハナママ', [b.dogs[0]!.id], { now: '2026-10-27T01:00:00Z' }); // 前の日に無料券が出る
    await checkin(PAPA, a.dogs.map((d) => d.id), { now: '2026-10-28T00:30:00Z' });
    await checkin('U002:ハナママ', [b.dogs[0]!.id], { now: DAY1, useTicket: true });

    const res = await adminCall('/admin/api/today', { cookie: staff, now: '2026-10-28T02:00:00Z' });
    expect(res.status).toBe(200);
    expect(res.body.date).toBe('2026-10-28');
    expect(res.body.visits).toHaveLength(2);
    expect(res.body.visits[0]).toMatchObject({
      time: '10:00',
      memberNo: b.memberNo,
      householdName: 'ハナのおうち',
      usedTicket: true,
      method: 'self',
      cancelled: false,
    });
    expect(res.body.visits[1].dogs.map((d: { name: string }) => d.name)).toEqual(['アル', 'ニコ']);
    expect(res.body.totals).toEqual({ groups: 2, memberDogs: 3, walkinDogs: 0, ticketsUsed: 1 });
  });

  it('受付スタッフには LINE の表示名と確認待ちの件数を返さない。管理者には返す', async () => {
    const { admin, staff } = await setup();
    const a = await registerUser(PAPA);
    await checkin(PAPA, [a.dogs[0]!.id], { now: DAY1 });
    const s = await adminCall('/admin/api/today', { cookie: staff, now: DAY1 });
    expect(s.body.visits[0].checkedInBy).toBeNull();
    expect(s.body.pendingRequests).toBeNull();
    const m = await adminCall('/admin/api/today', { cookie: admin, now: DAY1 });
    expect(m.body.visits[0].checkedInBy).toBe('パパ');
    expect(m.body.pendingRequests).toBe(0);
  });

  it('製作者も見られる', async () => {
    const { dev } = await setup();
    expect((await adminCall('/admin/api/today', { cookie: dev, now: DAY1 })).status).toBe(200);
  });

  it('取り消した来場は一覧に残し、集計からは外す', async () => {
    const { staff } = await setup();
    const a = await registerUser(PAPA);
    await checkin(PAPA, [a.dogs[0]!.id], { now: DAY1 });
    await env.DB.prepare("UPDATE visits SET cancelled_at = '2026-10-28T10:05:00+09:00'").run();
    const res = await adminCall('/admin/api/today', { cookie: staff, now: DAY1 });
    expect(res.body.visits[0].cancelled).toBe(true);
    expect(res.body.totals.groups).toBe(0);
  });

  it('写真はログインしている人だけが見られる', async () => {
    const { staff } = await setup();
    const a = await registerUser(PAPA);
    const form = new FormData();
    form.append('photo', new File([fakeJpeg(800, 600)], 'p.jpg', { type: 'image/jpeg' }));
    form.append('thumb', new File([fakeJpeg(240, 240)], 't.jpg', { type: 'image/jpeg' }));
    await call(`/api/dogs/${a.dogs[0]!.id}/photo`, { user: PAPA, body: form });
    await checkin(PAPA, [a.dogs[0]!.id], { now: DAY1 });
    const res = await adminCall('/admin/api/today', { cookie: staff, now: DAY1 });
    const url = res.body.visits[0].dogs[0].thumbUrl as string;
    expect(url).toMatch(/^\/admin\/api\/media\/dogs\//);
    expect((await adminCall(url, { cookie: staff })).status).toBe(200);
    expect((await adminCall(url)).status).toBe(401);
    expect((await adminCall('/admin/api/media/other/x.jpg', { cookie: staff })).status).toBe(404);
  });

  it('ログインしていないと見られない', async () => {
    expect((await adminCall('/admin/api/today')).status).toBe(401);
  });
});
