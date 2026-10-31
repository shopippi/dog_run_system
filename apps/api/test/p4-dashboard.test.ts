import { SELF, env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runNightly, runPostalAreasJob } from '../src/cron';
import { refreshDailyStatsRange } from '../src/services/daily-stats';
import { lookupPostalAreas, pendingPostalCodes, POSTAL_LOOKUP_URL } from '../src/services/postal-areas';
import { BASE, adminCall, createStaff, login } from './helpers';

// 2026-10-29 ダッシュボードの作り直し(docs/design.md 12章): 推移と前の期間・地域・日ごとのカレンダー・日の詳細・
// 天気と来場・日々のメモ・AI に渡す分析パックの CSV
const NOW = '2026-10-28T03:00:00Z'; // 日本時間 2026-10-28(水)12:00

async function cookieOf(role: 'staff' | 'admin' | 'developer') {
  await createStaff(`${role}@example.com`, role);
  return login(`${role}@example.com`, 'password-1234', NOW);
}
async function household(id: number, postal: string | null = null) {
  await env.DB.prepare(
    `INSERT INTO households (id, member_no, display_name, display_name_search, registered_at, postal_code, updated_at)
     VALUES (?, ?, ?, ?, '2026-01-01T09:00:00+09:00', ?, 'x')`,
  )
    .bind(id, `DR-${String(id).padStart(6, '0')}`, `おうち${id}`, `おうち${id}`, postal)
    .run();
}
async function visit(householdId: number | null, date: string, opts: { dogs?: number; time?: string; cancelled?: boolean } = {}) {
  await env.DB.prepare(
    `INSERT INTO visits (household_id, visit_date, checked_in_at, dog_count, method, cancelled_at) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(householdId, date, `${date}T${opts.time ?? '10:00'}:00+09:00`, opts.dogs ?? 1, householdId ? 'self' : 'walkin', opts.cancelled ? 'x' : null)
    .run();
}
async function weather(date: string, kind: string | null, max: number | null) {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO daily_weather (date, weather, temp_max, temp_min, precipitation, station, source, fetched_at)
     VALUES (?, ?, ?, 10, 0, '東京', '気象庁', 'x')`,
  )
    .bind(date, kind, max)
    .run();
}
async function closeDay(date: string, note = '芝生の手入れ') {
  await env.DB.prepare(
    `INSERT INTO calendar (date, weekday, day_type, is_closed, closed_note, updated_at) VALUES (?, 0, 'weekday', 1, ?, 'x')
     ON CONFLICT(date) DO UPDATE SET is_closed = 1, closed_note = excluded.closed_note`,
  )
    .bind(date, note)
    .run();
}
const stats = (from: string, to: string) => refreshDailyStatsRange(env.DB, from, to, new Date(NOW));
const zipJson = (address1: string, address2: string, address3: string) =>
  new Response(JSON.stringify({ status: 200, message: null, results: [{ address1, address2, address3, zipcode: 'x' }] }), {
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => vi.restoreAllMocks());

describe('郵便番号から地域を調べる(postal_areas)', () => {
  it('まだ調べていない番号だけを、上限の数まで調べる。見つからない番号も残し、次は調べない', async () => {
    await household(1, '1540001');
    await household(2, '154-0017');
    await household(3, '1540001'); // 同じ番号は1回だけ
    await household(4, '9999999');
    await household(5, 'abc'); // 読めない番号は調べない
    expect(await pendingPostalCodes(env.DB)).toEqual(['1540001', '1540017', '9999999']);
    const calls: string[] = [];
    const sleeps: number[] = [];
    const fetcher = (async (url: string) => {
      calls.push(url);
      if (url.endsWith('9999999')) return new Response(JSON.stringify({ status: 200, message: null, results: null }));
      return url.endsWith('1540001') ? zipJson('東京都', '世田谷区', '池尻') : zipJson('東京都', '世田谷区', '世田谷');
    }) as unknown as typeof fetch;
    const first = await lookupPostalAreas(env.DB, new Date(NOW), { fetcher, limit: 2, delayMs: 300, sleep: async (ms) => void sleeps.push(ms) });
    expect(calls).toEqual([`${POSTAL_LOOKUP_URL}1540001`, `${POSTAL_LOOKUP_URL}1540017`]);
    expect(sleeps).toEqual([300]); // 1件ごとに間を空ける(最初の前は空けない)
    expect(first).toEqual({ message: '郵便番号を2件調べました。残りの1件は次の実行で調べます。' });
    const second = await lookupPostalAreas(env.DB, new Date(NOW), { fetcher, limit: 2, sleep: async () => {} });
    expect(second.message).toBe('郵便番号を1件調べました(見つからなかった番号 1件)。');
    const rows = await env.DB.prepare('SELECT postal_code, prefecture, city, town, status FROM postal_areas ORDER BY postal_code').all();
    expect(rows.results).toEqual([
      { postal_code: '1540001', prefecture: '東京都', city: '世田谷区', town: '池尻', status: 'found' },
      { postal_code: '1540017', prefecture: '東京都', city: '世田谷区', town: '世田谷', status: 'found' },
      { postal_code: '9999999', prefecture: null, city: null, town: null, status: 'not_found' },
    ]);
    expect((await lookupPostalAreas(env.DB, new Date(NOW), { fetcher })).message).toBe('調べる郵便番号はありませんでした(すべて調べてあります)。');
    expect(calls).toHaveLength(3);
  });

  it('つながらないときは「失敗」、一部だけ失敗したときは「一部だけ」。失敗した番号は残さず、次に調べ直す', async () => {
    await household(1, '1540001');
    await household(2, '1520004');
    const down = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const failed = await runJobWith(down);
    expect(failed.status).toBe('failed');
    expect(failed.message).toBe('郵便番号の調べ先(zipcloud)につながりませんでした。少し待ってから、もう一度お試しください。');
    const half = (async (url: string) =>
      url.endsWith('1540001') ? zipJson('東京都', '世田谷区', '池尻') : new Response('busy', { status: 503 })) as unknown as typeof fetch;
    const out = await lookupPostalAreas(env.DB, new Date(NOW), { fetcher: half, sleep: async () => {} });
    expect(out.status).toBe('warning');
    expect(out.message).toBe('郵便番号を1件調べました。1件は調べられませんでした。残りの1件は次の実行で調べます。');
    expect(await pendingPostalCodes(env.DB)).toEqual(['1520004']);
  });

  it('つながらない環境(デモ)ではスキップする。毎晩の処理の中でも動き、システムの状態に出る', async () => {
    await household(1, '1540001');
    const spy = vi.spyOn(globalThis, 'fetch');
    const skipped = await runPostalAreasJob({ ...env, OFFLINE: '1' }, new Date(NOW));
    expect(skipped).toEqual({ status: 'ok', message: 'スキップしました(インターネットにつながらない環境のため)。' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockImplementation(async (input) =>
      String(input).startsWith(POSTAL_LOOKUP_URL) ? zipJson('東京都', '世田谷区', '池尻') : new Response('blocked', { status: 404 }),
    );
    await runNightly({ ...env, OFFLINE: undefined }, new Date('2026-10-27T18:10:00Z'));
    const job = await env.DB.prepare("SELECT status, message FROM system_jobs WHERE name = 'postal_areas' ORDER BY id DESC LIMIT 1").first();
    expect(job).toEqual({ status: 'ok', message: '郵便番号を1件調べました。' });
  });

  it('管理画面の「今すぐ調べる」(管理者だけ。受付スタッフと製作者は 403)。操作ログに残る', async () => {
    await household(1, '1540001');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => zipJson('東京都', '世田谷区', '池尻'));
    const staff = await cookieOf('staff');
    expect((await adminCall('/admin/api/system/run/postal_areas', { cookie: staff, body: {}, now: NOW })).status).toBe(403);
    const dev = await cookieOf('developer');
    expect((await adminCall('/admin/api/system/run/postal_areas', { cookie: dev, body: {}, now: NOW })).status).toBe(403);
    const admin = await cookieOf('admin');
    const res = await adminCall('/admin/api/system/run/postal_areas', { cookie: admin, body: {}, now: NOW });
    expect(res.body).toEqual({ status: 'ok', message: '郵便番号を1件調べました。' });
    const log = await env.DB.prepare("SELECT action FROM audit_log WHERE action = 'system.run.postal_areas'").first();
    expect(log).toBeTruthy();
  });
});

async function runJobWith(fetcher: typeof fetch) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(fetcher as never);
  const out = await runPostalAreasJob({ ...env, OFFLINE: undefined }, new Date(NOW));
  vi.restoreAllMocks();
  return out;
}

describe('ダッシュボードの推移と前の期間・地域・天気と来場', () => {
  it('7日: 1日ごとの7つの区切りと、前の7日。合計と前の期間の合計', async () => {
    const cookie = await cookieOf('admin');
    await household(1);
    await visit(1, '2026-10-28', { dogs: 2 });
    await visit(null, '2026-10-27', { dogs: 3 });
    await visit(1, '2026-10-21'); // 前の期間(10-15〜10-21)の終わり
    await visit(1, '2026-10-15'); // 前の期間の始まり
    await visit(1, '2026-10-14'); // どちらにも入らない
    await stats('2026-10-01', '2026-10-28');
    const res = await adminCall(`/admin/api/dashboard?range=7d`, { cookie, now: NOW });
    expect(res.status).toBe(200);
    const t = res.body.trend;
    expect(res.body.from).toBe('2026-10-22');
    expect(res.body.to).toBe('2026-10-28');
    expect(t.granularity).toBe('day');
    expect(t.previous).toEqual({ from: '2026-10-15', to: '2026-10-21' });
    expect(t.current.map((b: { start: string }) => b.start)).toEqual([
      '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28',
    ]);
    expect(t.previousBuckets).toHaveLength(7);
    expect(t.totals).toEqual({ groups: 2, dogs: 5, dogsWalkin: 3, newHouseholds: 0, ticketsUsed: 0 });
    expect(t.previousTotals.groups).toBe(2);
    expect(t.current[6]).toMatchObject({ groups: 1, memberGroups: 1, dogs: 2 });
    expect(t.current[5]).toMatchObject({ groups: 1, memberGroups: 0, dogsWalkin: 3 });
  });

  it('24時間: 1時間ごとの24の区切り(今の時まで)と、その前の24時間。取り消しと臨時休業日は数えない', async () => {
    const cookie = await cookieOf('admin');
    await household(1);
    await household(2);
    await household(3);
    await visit(1, '2026-10-28', { time: '11:20', dogs: 2 });
    await visit(2, '2026-10-28', { time: '11:40', cancelled: true });
    await visit(2, '2026-10-27', { time: '13:05' }); // 23時間前の時 → 1つ目の区切り
    await visit(3, '2026-10-27', { time: '09:00' }); // 前の24時間
    await visit(null, '2026-10-20', { time: '11:00' });
    const res = await adminCall(`/admin/api/dashboard?range=24h`, { cookie, now: NOW });
    const t = res.body.trend;
    expect(t.granularity).toBe('hour');
    expect(t.current).toHaveLength(24);
    expect(t.current[0].start).toBe('2026-10-27T13');
    expect(t.current[23].start).toBe('2026-10-28T12');
    expect(t.current[22]).toMatchObject({ start: '2026-10-28T11', groups: 1, dogs: 2 });
    expect(t.current[0]).toMatchObject({ groups: 1 });
    expect(t.totals.groups).toBe(2);
    expect(t.previous).toEqual({ from: '2026-10-26T13', to: '2026-10-27T12' });
    expect(t.previousTotals.groups).toBe(1);
  });

  it('12か月は1週ごと、期間を選んで400日を超えると1か月ごと', async () => {
    const cookie = await cookieOf('admin');
    const year = await adminCall(`/admin/api/dashboard?range=12m`, { cookie, now: NOW });
    expect(year.body.trend.granularity).toBe('week');
    expect(year.body.from).toBe('2025-10-29');
    expect(year.body.trend.current[0]).toMatchObject({ start: '2025-10-29', end: '2025-11-04' });
    expect(year.body.trend.current.at(-1).end).toBe('2026-10-28');
    const long = await adminCall(`/admin/api/dashboard?range=custom&from=2025-01-15&to=2026-10-28`, { cookie, now: NOW });
    expect(long.body.trend.granularity).toBe('month');
    expect(long.body.trend.current[0]).toMatchObject({ start: '2025-01-15', end: '2025-01-31' });
    expect(long.body.trend.current.at(-1)).toMatchObject({ start: '2026-10-01', end: '2026-10-28' });
    expect(long.body.trend.previousBuckets).toHaveLength(long.body.trend.current.length);
  });

  it('天気と来場: 天気ごとの1日あたりの来場組数(会員・会員以外の頭数)と日数。土日祝と平日。天気のない日と休業日は入れない', async () => {
    const cookie = await cookieOf('staff');
    await household(1);
    await household(2);
    // 10-24(土) 晴れ: 会員2組・会員以外2頭 / 10-26(月) 晴れ: 会員1組 / 10-27(火) 雨: 0組 / 10-28(水) 天気なし / 10-23(金) 休業(晴れ)
    await visit(1, '2026-10-24');
    await visit(2, '2026-10-24');
    await visit(null, '2026-10-24', { dogs: 2 });
    await visit(1, '2026-10-26');
    await visit(1, '2026-10-28');
    await visit(2, '2026-10-23');
    await closeDay('2026-10-23');
    await weather('2026-10-23', '晴れ', 20);
    await weather('2026-10-24', '晴れ', 21);
    await weather('2026-10-26', '晴れ', 19);
    await weather('2026-10-27', '雨', 15);
    await weather('2026-10-28', null, null);
    await stats('2026-10-20', '2026-10-28');
    const res = await adminCall(`/admin/api/dashboard?range=custom&from=2026-10-23&to=2026-10-28`, { cookie, now: NOW });
    const row = (kind: string, g: string) => res.body.weatherVisits.find((r: { kind: string; dayGroup: string }) => r.kind === kind && r.dayGroup === g);
    expect(row('晴れ', 'all')).toEqual({ kind: '晴れ', dayGroup: 'all', days: 2, avgGroups: 2, avgMemberGroups: 1.5, avgWalkinDogs: 1, avgDogs: 2.5 });
    expect(row('晴れ', 'weekend')).toMatchObject({ days: 1, avgGroups: 3, avgMemberGroups: 2, avgWalkinDogs: 2 });
    expect(row('晴れ', 'weekday')).toMatchObject({ days: 1, avgGroups: 1, avgMemberGroups: 1 });
    expect(row('雨', 'all')).toMatchObject({ days: 1, avgGroups: 0 });
    expect(row('曇り', 'all')).toMatchObject({ days: 0, avgGroups: null });
  });

  it('どこから来ているか: 市区町村ごとのおうち・来場、町域。郵便番号なし・まだ調べていない・見つからないを分ける', async () => {
    const cookie = await cookieOf('admin');
    await household(1, '1540001');
    await household(2, '1540017');
    await household(3, '1520004');
    await household(4, null);
    await household(5, '1810013'); // まだ調べていない
    await household(6, '9999999'); // 見つからない
    await env.DB.prepare(
      `INSERT INTO postal_areas (postal_code, prefecture, city, town, status, looked_up_at) VALUES
        ('1540001', '東京都', '世田谷区', '池尻', 'found', 'x'), ('1540017', '東京都', '世田谷区', '世田谷', 'found', 'x'),
        ('1520004', '東京都', '目黒区', '鷹番', 'found', 'x'), ('9999999', NULL, NULL, NULL, 'not_found', 'x')`,
    ).run();
    for (const [h, d] of [[1, '2026-10-01'], [1, '2026-10-02'], [2, '2026-10-03'], [3, '2026-10-04'], [4, '2026-10-05'], [5, '2026-10-06'], [6, '2026-10-07']] as const) {
      await visit(h, d);
    }
    await visit(3, '2026-09-30'); // 期間の外
    const res = await adminCall(`/admin/api/dashboard?range=custom&from=2026-10-01&to=2026-10-28`, { cookie, now: NOW });
    const a = res.body.areas;
    expect(a.rows.map((r: { key: string; households: number; visits: number }) => [r.key, r.households, r.visits])).toEqual([
      ['東京都 世田谷区', 2, 3],
      ['東京都 目黒区', 1, 1],
    ]);
    expect(a.rows[0].towns).toEqual([
      { town: '池尻', households: 1, visits: 2 },
      { town: '世田谷', households: 1, visits: 1 },
    ]);
    expect(a.noPostal).toEqual({ households: 1, visits: 1 });
    expect(a.pending).toEqual({ households: 1, visits: 1, codes: 1 });
    expect(a.notFound).toEqual({ households: 1, visits: 1 });
  });
});

describe('日ごとのカレンダーと日の詳細', () => {
  it('月のカレンダー: 月の初めから終わりまで(10月は31日・2月は28日)。天気・来場・イベント・メモ・休業の印', async () => {
    const cookie = await cookieOf('staff');
    await household(1);
    await visit(1, '2026-10-01');
    await visit(null, '2026-10-31', { dogs: 1 }); // 今日より先(数えない)
    await visit(1, '2026-10-12', { dogs: 2 });
    await closeDay('2026-10-12');
    await weather('2026-10-01', '曇り', 22.5);
    await env.DB.prepare("INSERT INTO events (date, name, created_at) VALUES ('2026-10-01', 'しつけ教室', 'x')").run();
    await env.DB.prepare(
      "INSERT INTO day_notes (date, body, created_at, updated_at) VALUES ('2026-10-01', '午後から雨', 'x', 'x'), ('2026-10-01', '消したメモ', 'x', 'x')",
    ).run();
    await env.DB.prepare("UPDATE day_notes SET deleted_at = 'x' WHERE body = '消したメモ'").run();
    await stats('2026-10-01', '2026-10-31');
    const res = await adminCall('/admin/api/dashboard/days?month=2026-10', { cookie, now: NOW });
    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(31);
    expect(res.body.days[0]).toMatchObject({
      date: '2026-10-01', weather: '曇り', tempMax: 22.5, groups: 1, memberGroups: 1, events: ['しつけ教室'], noteCount: 1, closed: false, future: false,
    });
    expect(res.body.days[11]).toMatchObject({ date: '2026-10-12', closed: true, closedNote: '芝生の手入れ', groups: 0, weather: null, tempMax: null });
    expect(res.body.days[30]).toMatchObject({ date: '2026-10-31', future: true, groups: 0 });
    expect(res.body.maxGroups).toBe(1);
    const feb = await adminCall('/admin/api/dashboard/days?month=2026-02', { cookie, now: NOW });
    expect(feb.body.days.map((d: { date: string }) => d.date).slice(-1)).toEqual(['2026-02-28']);
    expect((await adminCall('/admin/api/dashboard/days?month=2026-13', { cookie, now: NOW })).status).toBe(400);
  });

  it('日の詳細: 天気・内訳・1時間ごと・イベント・メモ。その日の来場の一覧', async () => {
    const cookie = await cookieOf('staff');
    await household(1);
    await household(2);
    await visit(1, '2026-10-24', { time: '09:15', dogs: 2 });
    await visit(2, '2026-10-24', { time: '09:50' });
    await visit(null, '2026-10-24', { time: '15:00', dogs: 3 });
    await visit(2, '2026-10-24', { time: '16:00', cancelled: true });
    await weather('2026-10-24', '晴れ', 21);
    await env.DB.prepare("INSERT INTO events (date, name, kind, memo, created_at) VALUES ('2026-10-24', 'ハロウィン', '季節', '仮装', 'x')").run();
    await stats('2026-10-24', '2026-10-24');
    const res = await adminCall('/admin/api/dashboard/day/2026-10-24', { cookie, now: NOW });
    expect(res.body).toMatchObject({
      date: '2026-10-24',
      dayType: 'saturday',
      closed: false,
      weather: { kind: '晴れ', tempMax: 21, tempMin: 10, precipitation: 0, station: '東京' },
      totals: { groups: 3, memberGroups: 2, dogs: 6, dogsMember: 3, dogsWalkin: 3 },
      events: [{ name: 'ハロウィン', kind: '季節', memo: '仮装' }],
      notes: [],
    });
    expect(res.body.hourly).toHaveLength(24);
    expect(res.body.hourly[9]).toEqual({ hour: 9, groups: 2, dogs: 3 });
    expect(res.body.hourly[15]).toEqual({ hour: 15, groups: 1, dogs: 3 });
    expect(res.body.hourly[16]).toEqual({ hour: 16, groups: 0, dogs: 0 });
    // 天気のない日は weather = null
    const none = await adminCall('/admin/api/dashboard/day/2026-10-25', { cookie, now: NOW });
    expect(none.body.weather).toBeNull();
    expect(none.body.totals.groups).toBe(0);
    const list = await adminCall('/admin/api/dashboard/day/2026-10-24/visits', { cookie: await cookieOf('admin'), now: NOW });
    expect(list.body.visits).toHaveLength(4);
    expect(list.body.totals).toEqual({ groups: 3, memberDogs: 3, walkinDogs: 3, ticketsUsed: 0 });
    expect((await adminCall('/admin/api/dashboard/day/2026-02-30', { cookie, now: NOW })).status).toBe(400);
  });

  it('受付スタッフが見られる来場の一覧は今日の分だけ(ほかの日は 403。日の集計は見られる)。管理者・製作者はほかの日も見られる', async () => {
    const staff = await cookieOf('staff');
    const past = await adminCall('/admin/api/dashboard/day/2026-10-24/visits', { cookie: staff, now: NOW });
    expect(past.status).toBe(403);
    expect(past.body.error.message).toContain('今日の分だけ');
    expect((await adminCall('/admin/api/dashboard/day/2026-10-24', { cookie: staff, now: NOW })).status).toBe(200);
    const today = NOW.slice(0, 10);
    expect((await adminCall(`/admin/api/dashboard/day/${today}/visits`, { cookie: staff, now: NOW })).status).toBe(200);
    expect((await adminCall('/admin/api/dashboard/day/2026-10-24/visits', { cookie: await cookieOf('admin'), now: NOW })).status).toBe(200);
    expect((await adminCall('/admin/api/dashboard/day/2026-10-24/visits', { cookie: await cookieOf('developer'), now: NOW })).status).toBe(200);
  });
});

describe('日々のメモ(day_notes)', () => {
  it('受付スタッフが書く・直す・消す。操作ログに残り、管理者は元に戻せる。製作者は見るだけ(403)', async () => {
    const staff = await cookieOf('staff');
    const admin = await cookieOf('admin');
    const dev = await cookieOf('developer');
    const created = await adminCall('/admin/api/day-notes', { cookie: staff, body: { date: '2026-10-28', body: '  午後から雨。\n小型犬の集まり。 ' }, now: NOW });
    expect(created.status).toBe(201);
    expect(created.body.note).toMatchObject({ date: '2026-10-28', body: '午後から雨。\n小型犬の集まり。', createdBy: '受付', updatedBy: null });
    expect(typeof created.body.auditId).toBe('number');
    const id = created.body.note.id;

    const updated = await adminCall(`/admin/api/day-notes/${id}`, { cookie: staff, method: 'PATCH', body: { body: '午後から雨' }, now: NOW });
    expect(updated.status).toBe(200);
    expect(updated.body.note.body).toBe('午後から雨');
    // 同じ本文なら変えない(操作ログも増やさない)
    const same = await adminCall(`/admin/api/day-notes/${id}`, { cookie: staff, method: 'PATCH', body: { body: '午後から雨' }, now: NOW });
    expect(same.body.auditId).toBeNull();

    const list = await adminCall('/admin/api/day-notes?date=2026-10-28', { cookie: dev, now: NOW });
    expect(list.body.notes.map((n: { body: string }) => n.body)).toEqual(['午後から雨']);

    // 直したのを元に戻す(管理者)
    expect((await adminCall(`/admin/api/audit/${updated.body.auditId}/undo`, { cookie: admin, body: {}, now: NOW })).status).toBe(200);
    expect((await adminCall('/admin/api/day-notes?date=2026-10-28', { cookie: staff, now: NOW })).body.notes[0].body).toBe('午後から雨。\n小型犬の集まり。');

    const removed = await adminCall(`/admin/api/day-notes/${id}`, { cookie: staff, method: 'DELETE', now: NOW });
    expect(removed.status).toBe(200);
    expect((await adminCall('/admin/api/day-notes?date=2026-10-28', { cookie: staff, now: NOW })).body.notes).toEqual([]);
    // 物理削除しない
    const row = await env.DB.prepare('SELECT deleted_at FROM day_notes WHERE id = ?').bind(id).first<{ deleted_at: string }>();
    expect(row!.deleted_at).toBe('2026-10-28T12:00:00+09:00');
    expect((await adminCall(`/admin/api/day-notes/${id}`, { cookie: staff, method: 'DELETE', now: NOW })).status).toBe(404);
    // 消したのを元に戻す
    expect((await adminCall(`/admin/api/audit/${removed.body.auditId}/undo`, { cookie: admin, body: {}, now: NOW })).status).toBe(200);
    expect((await adminCall('/admin/api/day-notes?date=2026-10-28', { cookie: staff, now: NOW })).body.notes).toHaveLength(1);
    // 書いたのを元に戻すと、消える
    expect((await adminCall(`/admin/api/audit/${created.body.auditId}/undo`, { cookie: admin, body: {}, now: NOW })).status).toBe(200);
    expect((await adminCall('/admin/api/day-notes?date=2026-10-28', { cookie: staff, now: NOW })).body.notes).toEqual([]);

    const actions = await env.DB.prepare("SELECT action FROM audit_log WHERE target_type = 'day_note' ORDER BY id").all<{ action: string }>();
    expect(actions.results.map((r) => r.action)).toEqual(['day_note.create', 'day_note.update', 'day_note.delete']);
    // 操作ログの画面の言葉
    const audit = await adminCall('/admin/api/audit', { cookie: admin, now: NOW });
    const entry = audit.body.entries.find((e: { actionLabel: string }) => e.actionLabel === 'その日のメモを書いた');
    expect(entry).toMatchObject({ target: { label: 'その日のメモ' }, detail: '10月28日「午後から雨。」' });

    // 製作者は見るだけ
    expect((await adminCall('/admin/api/day-notes', { cookie: dev, body: { date: '2026-10-28', body: 'x' }, now: NOW })).status).toBe(403);
    expect((await adminCall(`/admin/api/day-notes/${id}`, { cookie: dev, method: 'PATCH', body: { body: 'x' }, now: NOW })).status).toBe(403);
    expect((await adminCall(`/admin/api/day-notes/${id}`, { cookie: dev, method: 'DELETE', now: NOW })).status).toBe(403);
  });

  it('入力のチェック: 空・501文字・ない日付は 400。メモはカレンダーとグラフの吹き出し(1行目)に出る', async () => {
    const admin = await cookieOf('admin');
    const post = (body: unknown) => adminCall('/admin/api/day-notes', { cookie: admin, body, now: NOW });
    expect((await post({ date: '2026-10-28', body: '   ' })).body.error.message).toBe('メモを入力してください。');
    expect((await post({ date: '2026-10-28', body: 'あ'.repeat(501) })).body.error.message).toBe('メモは500文字までで入力してください。');
    expect((await post({ date: '2026-10-28', body: 'あ'.repeat(500) })).status).toBe(201);
    expect((await post({ date: '2026-02-29', body: 'x' })).body.error.message).toBe('その日付はありません。日付を選び直してください。');
    await post({ date: '2026-10-27', body: '小型犬の集まり\n2行目' });
    const res = await adminCall('/admin/api/dashboard?range=7d', { cookie: admin, now: NOW });
    const b = res.body.trend.current.find((x: { start: string }) => x.start === '2026-10-27');
    expect(b.notes).toEqual(['小型犬の集まり']);
  });
});

describe('AI に渡す分析パックの CSV', () => {
  async function download(cookie: string, path: string) {
    const res = await SELF.fetch(`${BASE}/admin/api/export/${path}`, { headers: { cookie, 'x-debug-now': NOW } });
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { res, bytes, lines: new TextDecoder().decode(bytes).replace(/^﻿/, '').split('\r\n').filter(Boolean) };
  }

  it('先頭に # の説明行(施設名・出力日時・期間・列の意味・注意・使い方)、1日1行、日本語の列名と単位。個人情報は入らない', async () => {
    const cookie = await cookieOf('admin');
    await env.DB.prepare(
      `INSERT INTO households (id, member_no, display_name, display_name_search, registered_at, postal_code, updated_at)
       VALUES (1, 'DR-000001', 'こむぎのおうち', 'こむぎのおうち', '2026-10-01T09:00:00+09:00', '1540001', 'x')`,
    ).run();
    await visit(1, '2026-10-26', { dogs: 2 });
    await visit(null, '2026-10-26', { dogs: 1 });
    await weather('2026-10-26', '晴れ', 19.5);
    await closeDay('2026-10-27', '台風のため');
    await env.DB.prepare("INSERT INTO events (date, name, created_at) VALUES ('2026-10-26', 'しつけ教室', 'x')").run();
    await env.DB.prepare("INSERT INTO day_notes (date, body, created_at, updated_at) VALUES ('2026-10-26', '午後から雨, 小型犬\n2行目', 'x', 'x')").run();
    await stats('2026-10-25', '2026-10-28');
    const { res, bytes, lines } = await download(cookie, 'analysis?from=2026-10-25&to=2026-10-31');
    expect(res.status).toBe(200);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const comments = lines.filter((l) => l.startsWith('#'));
    const table = lines.filter((l) => !l.startsWith('#'));
    expect(lines[0]).toBe('# グリーンドーム AIに渡す分析パック(CSV)');
    expect(comments).toContain('# 出力した日時: 2026-10-28 12:00(日本時間)');
    // 今日より先の日は出さない
    expect(comments).toContain('# 期間: 2026-10-25〜2026-10-28(日付はすべて日本時間)');
    expect(comments).toContain('# - 来場組数(組) = その日にチェックインしたおうちの数と、会員以外の入力の件数の合計(取り消しを除く)');
    expect(comments.some((l) => l.includes('名前・LINEの名前・会員ID・郵便番号は入っていません'))).toBe(true);
    // メモの列はスタッフが書いた文のまま。渡す前に確かめるよう、正直に書く
    expect(comments.some((l) => l.includes('「その日のメモ」「休業の理由」の列は、スタッフが書いた文のままです'))).toBe(true);
    expect(comments.some((l) => l.includes('『曜日と天気ごとの来場の傾向を教えて』'))).toBe(true);
    // 説明行は1つのセルに収まる(半角のカンマを含まない)
    expect(comments.every((l) => !l.includes(','))).toBe(true);
    expect(table[0]).toBe(
      '日付,曜日,曜日区分,祝日名,臨時休業,休業の理由,天気,最高気温(℃),最低気温(℃),降水量(mm),イベント,その日のメモ,来場組数(組),会員の来場組数(組),来場頭数(頭),会員のワンちゃん(頭),会員以外のワンちゃん(頭),初めて来たおうち(軒),新しいおうち(軒),無料券の発行(枚),無料券の使用(枚),預かりの予約(頭),お泊まりの予約(頭)',
    );
    expect(table.slice(1).map((l) => l.slice(0, 10))).toEqual(['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']);
    expect(table[2]).toBe('2026-10-26,月,平日,,,,晴れ,19.5,10,0,しつけ教室,"午後から雨, 小型犬 2行目",2,1,3,2,1,1,0,0,0,0,0');
    expect(table[3]).toBe('2026-10-27,火,平日,,休業,台風のため,,,,,,,0,0,0,0,0,0,0,0,0,0,0');
    const text = lines.join('\n');
    for (const secret of ['こむぎ', 'DR-000001', '1540001']) expect(text).not.toContain(secret);
  });

  it('おうちごとの表: 通し番号で、名前・会員ID・郵便番号は入らない(市区町村は入る)。「説明行を付けない」', async () => {
    const cookie = await cookieOf('admin');
    await env.DB.prepare(
      `INSERT INTO households (id, member_no, display_name, display_name_search, registered_at, postal_code, referral, updated_at)
       VALUES (7, 'DR-000007', 'だいずのおうち', 'だいずのおうち', '2026-09-03T09:00:00+09:00', '1540001', 'Instagram', 'x')`,
    ).run();
    await env.DB.prepare("INSERT INTO postal_areas (postal_code, prefecture, city, town, status, looked_up_at) VALUES ('1540001', '東京都', '世田谷区', '池尻', 'found', 'x')").run();
    await visit(7, '2026-10-01');
    await visit(7, '2026-10-20');
    const { lines } = await download(cookie, 'analysis_households?from=2026-10-10&to=2026-10-28&plain=1');
    expect(lines[0]!.startsWith('#')).toBe(false);
    expect(lines[0]!.split(',').slice(0, 5)).toEqual(['おうち番号', '登録した月', '登録のしかた', '都道府県', '市区町村']);
    expect(lines[1]).toBe('1,2026-09,新規,東京都,世田谷区,Instagram,,,,,0,0,,,1,2,2026-10-01,2026-10-20,8,0,0');
    const text = lines.join('\n');
    for (const secret of ['だいず', 'DR-000007', '1540001', '池尻']) expect(text).not.toContain(secret);
  });

  it('期間を空にすると、利用が始まった日から今日まで', async () => {
    const cookie = await cookieOf('admin');
    await visit(null, '2026-10-20');
    const { lines } = await download(cookie, 'analysis?plain=1');
    expect(lines[1]!.slice(0, 10)).toBe('2026-10-20');
    expect(lines.at(-1)!.slice(0, 10)).toBe('2026-10-28');
  });
});
