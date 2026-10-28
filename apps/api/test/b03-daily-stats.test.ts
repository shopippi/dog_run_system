import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { runScheduled } from '../src/cron';
import { refreshDailyStats } from '../src/services/daily-stats';
import { addFamily, adminCall, call, checkin, createStaff, dog, givePoints, login, survey } from './helpers';

const PAPA = 'U001:パパ';
const MAMA = 'U002:ママ';
const DAY1 = '2026-10-28T01:00:00Z'; // 日本時間 10/28 10:00(水)
const DAY2 = '2026-10-29T01:00:00Z';

async function register(user: string, dogs = [dog('アル')], now = DAY1) {
  const res = await call('/api/register', { user, now, body: { consent: true, dogs, survey: survey() } });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body as { memberNo: string; dogs: { id: number }[] };
}
async function staffCookie() {
  await createStaff('staff@example.com', 'staff');
  return login('staff@example.com');
}
async function stats(date: string) {
  return env.DB.prepare(
    `SELECT visit_groups, dogs_member, dogs_walkin, new_households, first_visit_households, tickets_used
       FROM daily_stats WHERE date = ?`,
  )
    .bind(date)
    .first();
}

describe('B-03 日別集計', () => {
  it('チェックインのたびに、その日の来場組数・頭数・新規おうち・初来場が更新される', async () => {
    const a = await register(PAPA, [dog('アル'), dog('ニコ')]);
    const b = await register(MAMA);
    await checkin(PAPA, a.dogs.map((d) => d.id), { now: DAY1 });
    expect(await stats('2026-10-28')).toEqual({
      visit_groups: 1,
      dogs_member: 2,
      dogs_walkin: 0,
      new_households: 2,
      first_visit_households: 1,
      tickets_used: 0,
    });
    await checkin(MAMA, [b.dogs[0]!.id], { now: DAY1 });
    expect(await stats('2026-10-28')).toMatchObject({ visit_groups: 2, dogs_member: 3, first_visit_households: 2 });

    // 2回目の来場の日は、初来場に数えない
    await checkin(PAPA, [a.dogs[0]!.id], { now: DAY2 });
    expect(await stats('2026-10-29')).toMatchObject({ visit_groups: 1, dogs_member: 1, first_visit_households: 0, new_households: 0 });
  });

  it('会員以外の入力は、来場組数と会員以外の頭数に入る', async () => {
    const staff = await staffCookie();
    await adminCall('/admin/api/walkins', { cookie: staff, body: { dogCount: 3 }, now: DAY1 });
    expect(await stats('2026-10-28')).toMatchObject({ visit_groups: 1, dogs_member: 0, dogs_walkin: 3 });
  });

  it('取り消すと、その日の集計から外れる(初来場も戻る)', async () => {
    const staff = await staffCookie();
    const a = await register(PAPA);
    const v = await checkin(PAPA, [a.dogs[0]!.id], { now: DAY1 });
    const w = await adminCall('/admin/api/walkins', { cookie: staff, body: { dogCount: 2 }, now: DAY1 });
    await adminCall(`/admin/api/checkins/${v.body.visitId}/cancel`, { cookie: staff, body: { reason: '入力ミス' }, now: DAY1 });
    expect(await stats('2026-10-28')).toMatchObject({ visit_groups: 1, dogs_member: 0, dogs_walkin: 2, first_visit_households: 0 });
    await adminCall(`/admin/api/checkins/${w.body.id}/cancel`, { cookie: staff, body: { reason: '入力ミス' }, now: DAY1 });
    expect(await stats('2026-10-28')).toMatchObject({ visit_groups: 0, dogs_walkin: 0 });

    // 取り消したあとの日の来場が、そのおうちの初来場になる
    await checkin(PAPA, [a.dogs[0]!.id], { now: DAY2 });
    expect(await stats('2026-10-29')).toMatchObject({ first_visit_households: 1 });
  });

  it('同じ日に家族が犬を追加すると、頭数が増える(組数は増えない)', async () => {
    const a = await register(PAPA, [dog('アル'), dog('ニコ')]);
    await addFamily(a.memberNo, 'U002', 'ママ');
    const v = await checkin(PAPA, [a.dogs[0]!.id], { now: DAY1 });
    const res = await call(`/api/checkins/${v.body.visitId}/dogs`, { user: MAMA, now: DAY1, body: { dogIds: [a.dogs[1]!.id] } });
    expect(res.status).toBe(200);
    expect(await stats('2026-10-28')).toMatchObject({ visit_groups: 1, dogs_member: 2 });
  });

  it('無料券を使った来場を数える', async () => {
    const a = await register(PAPA);
    await givePoints(a.memberNo, 9);
    await checkin(PAPA, [a.dogs[0]!.id], { now: DAY1 }); // 10ポイントで無料券
    await checkin(PAPA, [a.dogs[0]!.id], { now: DAY2, useTicket: true });
    expect(await stats('2026-10-28')).toMatchObject({ tickets_used: 0 });
    expect(await stats('2026-10-29')).toMatchObject({ tickets_used: 1 });
  });

  it('代理チェックインで前の日を入力すると、その日の集計が更新される', async () => {
    const staff = await staffCookie();
    const a = await register(PAPA);
    const h = await env.DB.prepare('SELECT id FROM households').first<{ id: number }>();
    const res = await adminCall('/admin/api/checkins/proxy', {
      cookie: staff,
      now: DAY1,
      body: { householdId: h!.id, dogIds: [a.dogs[0]!.id], useTicket: false, date: '2026-10-25' },
    });
    expect(res.status).toBe(201);
    expect(await stats('2026-10-25')).toMatchObject({ visit_groups: 1, dogs_member: 1, first_visit_households: 1 });
  });

  it('臨時休業日は、すべての値を 0 にする', async () => {
    const a = await register(PAPA);
    await checkin(PAPA, [a.dogs[0]!.id], { now: DAY1 });
    await env.DB.prepare('UPDATE calendar SET is_closed = 1 WHERE date = ?').bind('2026-10-28').run();
    await refreshDailyStats(env.DB, '2026-10-28');
    expect(await stats('2026-10-28')).toEqual({
      visit_groups: 0,
      dogs_member: 0,
      dogs_walkin: 0,
      new_households: 0,
      first_visit_households: 0,
      tickets_used: 0,
    });
  });

  it('calendar に曜日と曜日区分の行を作る(すでにある行は変えない)', async () => {
    await env.DB.prepare(
      `INSERT INTO calendar (date, weekday, holiday_name, day_type, is_closed, updated_at)
       VALUES ('2026-11-03', 2, '文化の日', 'holiday', 1, 'x')`,
    ).run();
    for (const d of ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']) await refreshDailyStats(env.DB, d);
    const { results } = await env.DB.prepare('SELECT date, weekday, day_type, holiday_name, is_closed FROM calendar ORDER BY date').all();
    expect(results).toEqual([
      { date: '2026-10-31', weekday: 6, day_type: 'saturday', holiday_name: null, is_closed: 0 },
      { date: '2026-11-01', weekday: 0, day_type: 'sunday', holiday_name: null, is_closed: 0 },
      { date: '2026-11-02', weekday: 1, day_type: 'weekday', holiday_name: null, is_closed: 0 },
      { date: '2026-11-03', weekday: 2, day_type: 'holiday', holiday_name: '文化の日', is_closed: 1 },
    ]);
  });

  it('毎晩 3:10 に過去400日分を作り直し、ずれていた集計が直る。結果を記録する', async () => {
    const a = await register(PAPA);
    await checkin(PAPA, [a.dogs[0]!.id], { now: DAY1 });
    // 集計がずれた状態(例: 統合で来場が移った)を作る
    await env.DB.prepare("UPDATE daily_stats SET visit_groups = 99 WHERE date = '2026-10-28'").run();
    const at = new Date('2026-10-29T18:10:00Z'); // 日本時間 10/30 3:10
    await runScheduled('10 18 * * *', env, at);
    expect(await stats('2026-10-28')).toMatchObject({ visit_groups: 1 });
    const n = await env.DB.prepare('SELECT COUNT(*) AS n, MIN(date) AS first, MAX(date) AS last FROM daily_stats').first();
    expect(n).toEqual({ n: 400, first: '2025-09-26', last: '2026-10-30' });
    const cal = await env.DB.prepare('SELECT COUNT(*) AS n FROM calendar').first<{ n: number }>();
    expect(cal!.n).toBe(400);
    const job = await env.DB.prepare("SELECT status, started_at, message FROM system_jobs WHERE name = 'daily_stats'").first();
    expect(job).toMatchObject({ status: 'ok', started_at: '2026-10-30T03:10:00+09:00' });
  });
});
