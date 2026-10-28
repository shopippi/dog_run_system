import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { refreshDailyStatsRange } from '../src/services/daily-stats';
import { addFamily, adminCall, call, checkin, createStaff, dog, login, survey } from './helpers';

// ダッシュボード(A-01)の数値の検算。用意した来場データから、手で計算した値と一致することを確かめる(13章の定義)。
const NOW = '2026-10-28T03:00:00Z'; // 日本時間 2026-10-28(水)12:00 = 今日

async function cookieOf(role: 'staff' | 'admin' | 'developer') {
  await createStaff(`${role}@example.com`, role);
  return login(`${role}@example.com`, 'password-1234', NOW);
}
const dashboard = (cookie: string, from: string, to: string) =>
  adminCall(`/admin/api/dashboard?from=${from}&to=${to}`, { cookie, now: NOW });

async function household(id: number, status = 'active') {
  await env.DB.prepare(
    `INSERT INTO households (id, member_no, display_name, display_name_search, registered_at, status, updated_at)
     VALUES (?, ?, ?, ?, '2026-01-01T09:00:00+09:00', ?, 'x')`,
  )
    .bind(id, `DR-${String(id).padStart(6, '0')}`, `おうち${id}`, `おうち${id}`, status)
    .run();
}
async function visit(householdId: number | null, date: string, opts: { dogs?: number; cancelled?: boolean } = {}) {
  await env.DB.prepare(
    `INSERT INTO visits (household_id, visit_date, checked_in_at, dog_count, method, cancelled_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(householdId, date, `${date}T10:00:00+09:00`, opts.dogs ?? 1, householdId ? 'self' : 'walkin', opts.cancelled ? 'x' : null)
    .run();
}
async function closeDay(date: string) {
  await env.DB.prepare(
    `INSERT INTO calendar (date, weekday, day_type, is_closed, updated_at) VALUES (?, 0, 'weekday', 1, 'x')
     ON CONFLICT(date) DO UPDATE SET is_closed = 1`,
  )
    .bind(date)
    .run();
}
const range = (from: string, n: number) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });

/**
 * おうち単位の指標の検算用データ(今日 = 2026-10-28、期間 = 2026-06-01〜2026-10-28、リピート60日・休眠90日・3回)
 *  H1: 06-01, 06-20, 07-15          初回 6月。19日後に2回目 → リピート。3回・最後 07-15(105日前)→ 休眠
 *  H2: 06-10, 08-15                 初回 6月。66日後 → リピートでない
 *  H3: 07-05                        初回 7月。60日たっている → リピートでない(確定)
 *  H4: 10-01                        初回 10月。まだ60日たっていない → 判定待ち
 *  H5: 03-01, 03-10, 04-01, 05-01   期間の前から来ている。4回・最後 05-01(180日前)→ 休眠
 *  H6: 05-01, 05-02, 07-30          3回・最後 07-30(ちょうど90日前)→ 休眠
 *  H7: 05-01, 05-02, 07-31          3回・最後 07-31(89日前)→ 休眠でない(境界)
 *  H8: 06-05(取り消し), 08-01        初回は 08-01(取り消しは数えない)。60日たっている
 *  H9: 06-25(臨時休業日), 09-01      初回は 09-01(休業日は数えない)。まだ60日たっていない → 判定待ち
 *  H10: 05-20, 09-02〜09-11(10回)    期間中 10回
 *  H11: 05-21, 08-02〜08-05(4回)     期間中 4回
 *  H12(退会済み): 01-10, 01-11, 01-12  休眠の条件に合うが、退会済みなので一覧に出さない
 *  会員以外: 06-01 に 3頭
 */
async function seedHouseholds() {
  for (let id = 1; id <= 11; id++) await household(id);
  await household(12, 'withdrawn');
  const plan: [number, string[]][] = [
    [1, ['2026-06-01', '2026-06-20', '2026-07-15']],
    [2, ['2026-06-10', '2026-08-15']],
    [3, ['2026-07-05']],
    [4, ['2026-10-01']],
    [5, ['2026-03-01', '2026-03-10', '2026-04-01', '2026-05-01']],
    [6, ['2026-05-01', '2026-05-02', '2026-07-30']],
    [7, ['2026-05-01', '2026-05-02', '2026-07-31']],
    [8, ['2026-08-01']],
    [9, ['2026-06-25', '2026-09-01']],
    [10, ['2026-05-20', ...range('2026-09-02', 10)]],
    [11, ['2026-05-21', ...range('2026-08-02', 4)]],
    [12, ['2026-01-10', '2026-01-11', '2026-01-12']],
  ];
  for (const [h, dates] of plan) for (const d of dates) await visit(h, d);
  await visit(8, '2026-06-05', { cancelled: true });
  await visit(null, '2026-06-01', { dogs: 3 });
  await closeDay('2026-06-25');
  await refreshDailyStatsRange(env.DB, '2026-01-01', '2026-10-28');
}

describe('A-01 ダッシュボード(数値の検算)', () => {
  it('リピート率: 期間中に初めて来たおうちのうち、60日以内に2回目があった割合(初回来場月ごと)', async () => {
    await seedHouseholds();
    const admin = await cookieOf('admin');
    const res = await dashboard(admin, '2026-06-01', '2026-10-28');
    expect(res.status).toBe(200);
    // 初めて来たおうち: H1・H2(6月)、H3(7月)、H8(8月)、H9(9月)、H4(10月) = 6。リピートは H1 だけ
    expect(res.body.repeat).toMatchObject({ firstTimers: 6, repeaters: 1, pending: 2 });
    expect(res.body.repeat.rate).toBeCloseTo(1 / 6);
    expect(res.body.repeat.months).toEqual([
      { month: '2026-06', firstTimers: 2, repeaters: 1, pending: 0, rate: 0.5 },
      { month: '2026-07', firstTimers: 1, repeaters: 0, pending: 0, rate: 0 },
      { month: '2026-08', firstTimers: 1, repeaters: 0, pending: 0, rate: 0 },
      { month: '2026-09', firstTimers: 1, repeaters: 0, pending: 1, rate: 0 },
      { month: '2026-10', firstTimers: 1, repeaters: 0, pending: 1, rate: 0 },
    ]);
  });

  it('リピートの判定日数は設定(repeat_days)で変えられる', async () => {
    await seedHouseholds();
    await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('repeat_days', '70', 'x')").run();
    const admin = await cookieOf('admin');
    const res = await dashboard(admin, '2026-06-01', '2026-10-28');
    // 70日にすると H2(66日後)もリピートになる
    expect(res.body.repeat).toMatchObject({ firstTimers: 6, repeaters: 2 });
    expect(res.body.settings.repeatDays).toBe(70);
  });

  it('おうちの継続状況(コホート): 初回来場月ごとに、その後の各月にも来たおうちの数', async () => {
    await seedHouseholds();
    const admin = await cookieOf('admin');
    const res = await dashboard(admin, '2026-06-01', '2026-10-28');
    expect(res.body.cohort).toEqual({
      offsets: 5,
      rows: [
        { month: '2026-06', size: 2, active: [2, 1, 1, 0, 0] }, // H1 は7月、H2 は8月にも来た
        { month: '2026-07', size: 1, active: [1, 0, 0, 0, null] }, // 11月はまだ来ていない
        { month: '2026-08', size: 1, active: [1, 0, 0, null, null] },
        { month: '2026-09', size: 1, active: [1, 0, null, null, null] },
        { month: '2026-10', size: 1, active: [1, null, null, null, null] },
      ],
    });
  });

  it('来場頻度の分布: 期間中の来場回数ごとのおうちの数', async () => {
    await seedHouseholds();
    const admin = await cookieOf('admin');
    const res = await dashboard(admin, '2026-06-01', '2026-10-28');
    expect(res.body.frequency).toEqual([
      { label: '1回', count: 6 }, // H3・H4・H6・H7・H8・H9
      { label: '2〜3回', count: 2 }, // H1・H2
      { label: '4〜9回', count: 1 }, // H11
      { label: '10回以上', count: 1 }, // H10
    ]);
  });

  it('休眠している常連: 3回以上来て、直近90日来ていないおうち(90日ちょうどは休眠、89日は休眠でない)', async () => {
    await seedHouseholds();
    const admin = await cookieOf('admin');
    const res = await dashboard(admin, '2026-06-01', '2026-10-28');
    expect(res.body.dormant.total).toBe(3);
    expect(
      res.body.dormant.households.map((h: { memberNo: string; visits: number; lastVisit: string; daysSince: number }) => [
        h.memberNo,
        h.visits,
        h.lastVisit,
        h.daysSince,
      ]),
    ).toEqual([
      ['DR-000005', 4, '2026-05-01', 180],
      ['DR-000006', 3, '2026-07-30', 90],
      ['DR-000001', 3, '2026-07-15', 105],
    ]);
  });

  it('来場頭数・組数は daily_stats から(取り消しと臨時休業日を除く。会員以外を含む)', async () => {
    await seedHouseholds();
    const admin = await cookieOf('admin');
    const res = await dashboard(admin, '2026-06-01', '2026-10-28');
    // 期間中の来場: H1 3・H2 2・H3 1・H4 1・H6 1・H7 1・H8 1・H9 1・H10 10・H11 4 = 25組(各1頭)+ 会員以外 1組3頭
    expect(res.body.totals).toMatchObject({ groups: 26, dogs: 28, dogsMember: 25, dogsWalkin: 3 });
    const june = res.body.months.find((m: { month: string }) => m.month === '2026-06');
    expect(june).toMatchObject({ groups: 4, dogs: 6 }); // H1 2回・H2 1回・会員以外(3頭)
    const closed = res.body.days.find((d: { date: string }) => d.date === '2026-06-25');
    expect(closed).toMatchObject({ closed: true, open: false, dogs: 0 });
    expect(res.body.days).toHaveLength(150); // 6/1〜10/28
  });

  it('天気・曜日の影響、イベントの効果、1日あたりの平均', async () => {
    const plan: [string, number][] = [
      ['2026-10-03', 10], // 土 晴れ
      ['2026-10-04', 6], // 日 雨
      ['2026-10-05', 2], // 月 晴れ
      ['2026-10-10', 20], // 土 晴れ・イベント
      ['2026-10-12', 8], // 月・祝日 晴れ
      ['2026-10-17', 14], // 土 曇り
      ['2026-10-20', 5], // 火 臨時休業(数えない)
    ];
    for (const [d, n] of plan) await visit(null, d, { dogs: n });
    const weather: [string, string, number][] = [
      ['2026-10-03', '晴れ', 25],
      ['2026-10-04', '雨', 18],
      ['2026-10-05', '晴れ', 22],
      ['2026-10-10', '晴れ', 24],
      ['2026-10-12', '晴れ', 21],
      ['2026-10-17', '曇り', 19],
    ];
    for (const [d, w, t] of weather) {
      await env.DB.prepare(
        "INSERT INTO daily_weather (date, weather, temp_max, station, source, fetched_at) VALUES (?, ?, ?, '東京', '気象庁', 'x')",
      )
        .bind(d, w, t)
        .run();
    }
    await env.DB.prepare("INSERT INTO events (date, name, created_at) VALUES ('2026-10-10', 'ハロウィン', 'x')").run();
    await env.DB.prepare("INSERT INTO events (date, name, created_at, deleted_at) VALUES ('2026-10-17', '消したイベント', 'x', 'x')").run();
    await env.DB.prepare(
      "INSERT INTO calendar (date, weekday, holiday_name, day_type, is_closed, updated_at) VALUES ('2026-10-12', 1, 'スポーツの日', 'holiday', 0, 'x')",
    ).run();
    await closeDay('2026-10-20');
    await refreshDailyStatsRange(env.DB, '2026-10-01', '2026-10-28');

    const staff = await cookieOf('staff');
    const res = await dashboard(staff, '2026-10-01', '2026-10-28');
    // 利用が始まったのは 10/3。10/3〜10/28 の26日から休業日1日を除いた25日が営業日
    expect(res.body.totals).toMatchObject({ openDays: 25, dogs: 60, avgDogsPerDay: 2.4 });
    expect(res.body.weather.byKind).toEqual([
      { kind: '晴れ', days: 4, avgDogs: 10 }, // (10 + 2 + 20 + 8) / 4
      { kind: '曇り', days: 1, avgDogs: 14 },
      { kind: '雨', days: 1, avgDogs: 6 },
    ]);
    expect(res.body.weather).toMatchObject({ station: '東京', source: '気象庁' });
    expect(res.body.weather.points).toHaveLength(6);
    expect(res.body.weather.points[0]).toEqual({ date: '2026-10-03', tempMax: 25, dogs: 10 });
    expect(res.body.dayTypes).toEqual([
      { dayType: 'weekday', label: '平日', days: 16, avgDogs: 0.1 }, // 2 / 16
      { dayType: 'saturday', label: '土曜', days: 4, avgDogs: 11 }, // (10 + 20 + 14 + 0) / 4
      { dayType: 'sunday', label: '日曜', days: 4, avgDogs: 1.5 }, // 6 / 4
      { dayType: 'holiday', label: '祝日', days: 1, avgDogs: 8 },
    ]);
    // イベントの日(土曜 20頭)と、10月の土曜の通常日(10/3・10/17・10/24)の平均 8頭との差
    expect(res.body.events).toEqual([
      { date: '2026-10-10', names: ['ハロウィン'], dayType: 'saturday', dogs: 20, baseline: 8, diffPct: 150 },
    ]);
    // 受付スタッフには、管理者向けの指標を返さない
    expect(res.body.scope).toBe('summary');
    expect(res.body).toMatchObject({ cohort: null, dormant: null, family: null, surveys: null });
  });

  it('犬種・サイズ・年齢、飼い主の属性、家族での利用、無料券の利用', async () => {
    const reg = async (user: string, dogs: unknown[], extra: { questionId: number; value: string | null }[] = []) => {
      const res = await call('/api/register', { user, now: NOW, body: { consent: true, dogs, survey: survey(extra) } });
      if (res.status !== 201) throw new Error(JSON.stringify(res.body));
      return res.body as { memberNo: string; dogs: { id: number }[] };
    };
    const a = await reg(
      'U001:パパ',
      [dog('アル', { birthYm: '2016-01' }), dog('ニコ', { breedId: 5, size: 'medium', birthYm: '2025-06' })],
      [
        { questionId: 3, value: '1500001' },
        { questionId: 5, value: '車' },
      ],
    );
    const b = await reg('U002:ママ', [dog('モモ')]);
    await addFamily(a.memberNo, 'U003', 'むすめ');
    await env.DB.prepare("INSERT INTO point_ledger (household_id, delta, kind, actor_type, created_at) VALUES (1, 9, 'migration', 'system', 'x')").run();
    await checkin('U001:パパ', a.dogs.map((d) => d.id), { now: '2026-10-27T03:00:00Z' }); // 10ポイントで無料券
    await checkin('U003:むすめ', [a.dogs[0]!.id], { now: NOW, useTicket: true });
    await checkin('U002:ママ', [b.dogs[0]!.id], { now: NOW });
    // 追加したアンケート
    const q = await env.DB.prepare(
      `INSERT INTO survey_questions (target, kind, label, options, sort_order, created_at)
       VALUES ('household', 'choice', 'ほかのドッグランを使っていますか', '["使っている","使っていない"]', 60, 'x')`,
    ).run();
    const qid = q.meta.last_row_id;
    await env.DB.prepare(
      "INSERT INTO survey_answers (question_id, household_id, answer, answered_at) VALUES (?, 1, '使っている', 'x'), (?, 2, '使っている', 'x')",
    )
      .bind(qid, qid)
      .run();

    const admin = await cookieOf('admin');
    const res = await dashboard(admin, '2026-10-01', '2026-10-28');
    // 2頭で来た日は2頭とも数える。同じ犬は1頭として数える
    expect(res.body.dogs.total).toBe(3);
    expect(res.body.dogs.breeds).toEqual([
      { label: 'トイプードル', count: 2 },
      { label: '柴犬', count: 1 },
    ]);
    expect(res.body.dogs.sizes).toEqual([
      { label: '小型', count: 2 },
      { label: '中型', count: 1 },
      { label: '大型', count: 0 },
    ]);
    expect(res.body.dogs.ages).toEqual([
      { label: '1歳未満', count: 0 },
      { label: '1〜3歳', count: 1 }, // 2025-06 生まれ
      { label: '4〜6歳', count: 0 },
      { label: '7〜9歳', count: 0 },
      { label: '10歳以上', count: 1 }, // 2016-01 生まれ
      { label: 'わからない', count: 1 },
    ]);
    // チェックインした家族(パパ・むすめ・ママ)。むすめはアンケート未回答
    expect(res.body.owners.members).toBe(3);
    expect(res.body.owners.ageGroups.find((b: { label: string }) => b.label === '30代')).toEqual({ label: '30代', count: 2 });
    expect(res.body.owners.ageGroups.at(-1)).toEqual({ label: '未回答', count: 1 });
    expect(res.body.owners.areas).toEqual([
      { label: '〒150', count: 1 },
      { label: '未回答', count: 1 },
    ]);
    expect(res.body.owners.transports.find((b: { label: string }) => b.label === '車')).toEqual({ label: '車', count: 1 });
    expect(res.body.owners.referrals[0]).toEqual({ label: 'Instagram', count: 2 });
    // 家族での利用: 来場した2軒のうち、家族が2人以上はパパのおうち(期間中2回)
    expect(res.body.family).toEqual({ households: 2, multi: 1, rate: 0.5, avgVisitsMulti: 2, avgVisitsSingle: 1 });
    // 特典の利用: 発行1・利用1
    expect(res.body.totals).toMatchObject({ ticketsIssued: 1, ticketsUsed: 1, ticketUseRate: 1, newHouseholds: 2 });
    // 追加したアンケート
    expect(res.body.surveys).toEqual([
      {
        id: qid,
        label: 'ほかのドッグランを使っていますか',
        kind: 'choice',
        target: 'household',
        visible: true,
        answered: 2,
        answers: [
          { label: '使っている', count: 2 },
          { label: '使っていない', count: 0 },
        ],
        recentTexts: [],
      },
    ]);
  });

  it('製作者は、管理者と同じ指標を見られる。期間の指定がおかしいときは日本語で返す', async () => {
    const dev = await cookieOf('developer');
    const res = await adminCall('/admin/api/dashboard', { cookie: dev, now: NOW });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ from: '2026-10-01', to: '2026-10-28', scope: 'full' });
    expect(res.body.dormant).toEqual({ total: 0, households: [] });

    const bad = await dashboard(dev, '2026-10-28', '2026-10-01');
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toContain('期間の始まりが終わりより後');
    const tooLong = await dashboard(dev, '2020-01-01', '2026-10-28');
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.message).toContain('3年分まで');
  });
});

describe('A-01 ダッシュボード(速さ)', () => {
  it('おうち1万件・来場10万件のとき、1年分を5秒以内に返す', async () => {
    // 1万軒が、2025-11-01〜2026-10-28 の間に10回ずつ来る(来場10万件・来た犬10万頭)
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 10000)
       INSERT INTO households (id, member_no, display_name, display_name_search, registered_at, updated_at)
       SELECT i, printf('DR-%06d', i), 'おうち' || i, 'おうち' || i, '2025-11-01T09:00:00+09:00', 'x' FROM n`,
    ).run();
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 10000)
       INSERT INTO dogs (id, dog_no, household_id, name, name_search, breed_id, size, created_at, updated_at)
       SELECT i, printf('DR-%06d-1', i), i, 'いぬ' || i, 'いぬ' || i, 1 + (i % 10), 'small', 'x', 'x' FROM n`,
    ).run();
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 99999)
       INSERT INTO visits (id, household_id, visit_date, checked_in_at, dog_count, method)
       SELECT i + 1, (i % 10000) + 1, date('2025-11-01', '+' || ((i / 10000) * 36 + (i % 36)) || ' days'), 'x', 1, 'self' FROM n`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO visit_dogs (visit_id, dog_id, visit_date, created_at) SELECT id, household_id, visit_date, 'x' FROM visits`,
    ).run();
    await refreshDailyStatsRange(env.DB, '2025-10-29', '2026-10-28');
    const admin = await cookieOf('admin');
    const started = Date.now();
    const res = await dashboard(admin, '2025-10-29', '2026-10-28');
    const ms = Date.now() - started;
    expect(res.status).toBe(200);
    expect(res.body.totals.groups).toBe(100000);
    expect(ms).toBeLessThan(5000);
  }, 60_000);
});
