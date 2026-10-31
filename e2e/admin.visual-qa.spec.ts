import { expect, test } from '@playwright/test';
import { adminApiLogin, bookDaycareApi, dayAhead, jstToday, markExperienced, registerApi, setOverride } from './booking-helpers';
import { checkinOn } from './customer-helpers';
import { adminLogin, newLineUser } from './helpers';
import { sql } from './merge-helpers';
import { VqaLog, type AuditOptions } from './visual-qa-helpers';

// 受付・管理画面の見え方の点検(重なり・切れ・はみ出し・押しにくさ)。PC・タブレット・スマホの幅。
// ふだん(CI)は 768 と 390。VQA_FULL=1 で 1280・1024・768・390・360。VQA_SHOTS で写真を保存する。

const ALL = [
  { id: 'admin-1280', viewport: { width: 1280, height: 800 }, touch: false },
  { id: 'admin-1024', viewport: { width: 1024, height: 768 }, touch: true },
  { id: 'admin-768', viewport: { width: 768, height: 1024 }, touch: true },
  { id: 'admin-390', viewport: { width: 390, height: 844 }, touch: true },
  { id: 'admin-360', viewport: { width: 360, height: 740 }, touch: true },
];
const sizes = process.env.VQA_FULL === '1' ? ALL : ALL.filter((v) => ['admin-768', 'admin-390'].includes(v.id));

const LONG_HOUSE = 'アレキサンダー・エリザベス・ミケランジェロのおうち';

for (const [i, v] of sizes.entries()) {
  test(`見え方の点検 管理画面 ${v.id}`, async ({ browser, request }) => {
    test.setTimeout(240_000);
    const log = new VqaLog(v.id);
    const opts: AuditOptions = {
      // 指で操作する端末(pointer: coarse)では 44。Playwright のタブレット(hasTouch だけ)は coarse にならないので 40 で測る
      minTap: 40,
      // 上のメニュー(960px 未満)は横にスクロールする。グラフの中の目盛りは押す部品ではない
      ignore: ['.toasts', 'svg'],
      checkCovered: false,
      // 一覧のメモは1行の下見(全文は予約の内容のダイアログ)。サイドバーの名前は長いときだけ … で切る(design.md 11.4)
      allowClip: ['.bk-adm-note', '.who'],
    };
    const date = dayAhead(46 + (i % 3));
    for (const service of ['daycare', 'boarding']) {
      await setOverride(request, { date, service, caps: { small: 100, medium: 100, large: 100 } });
    }
    const user = newLineUser('ママ');
    const u = await registerApi(request, user, [
      { name: 'マクシミリアンヌ・ド・ラ・モンターニュ' },
      { name: 'Christophersonwolf', size: 'large' },
      { name: 'ジョセフィーヌ', size: 'medium' },
    ]);
    const hid = sql(`SELECT id FROM households WHERE member_no = '${u.memberNo}'`)[0]!.id as number;
    await adminApiLogin(request, 'admin');
    await request.patch(`/admin/api/households/${hid}`, { headers: { 'x-dr-admin': '1' }, data: { displayName: LONG_HOUSE } });
    await markExperienced(request, u.dogs[0]!.id);
    await bookDaycareApi(request, user, [u.dogs[0]!.id], date, { note: '朝ごはんは食べてきます。マクシミリアンヌは雷が苦手なので、静かな部屋でお願いします。お薬は1日1回、夕方に。' });
    await bookDaycareApi(request, user, [u.dogs[1]!.id, u.dogs[2]!.id], date);
    await checkinOn(request, user, jstToday());
    await adminApiLogin(request, 'admin');
    await request.post('/admin/api/bookings', {
      headers: { 'x-dr-admin': '1' },
      data: { householdId: hid, dogIds: [u.dogs[2]!.id], service: 'daycare', startDate: jstToday(), endDate: jstToday(), startTime: '09:30', endTime: '17:00', note: 'お薬を1日1回' },
    });

    const page = await browser.newPage({ viewport: v.viewport, hasTouch: v.touch, isMobile: v.viewport.width < 500 });
    const check = (name: string) => log.check(page, name, opts);
    await adminLogin(page, 'admin');
    await page.getByRole('region', { name: '今日の預け・お迎え' }).getByRole('button').first().waitFor();
    await check('M-02 今日の来場(預け・お迎え)');

    await page.goto(`/admin/bookings?service=daycare&date=${date}`);
    await page.getByRole('heading', { name: '予約カレンダー' }).waitFor();
    await page.getByRole('region', { name: /の預かり$/ }).locator('.bk-adm-list').getByRole('button').first().waitFor();
    await check('M-20 予約カレンダー(月と日の予定)');
    await page.getByRole('tab', { name: '週' }).click();
    await page.locator('.bk-chip').first().waitFor();
    await check('M-20 予約カレンダー(週)');
    await page.getByRole('tab', { name: 'お泊まり' }).click();
    await check('M-20 予約カレンダー(お泊まり)');

    await page.goto('/admin/bookings/pending');
    await page.getByRole('heading', { name: '確認待ちの予約' }).waitFor();
    await page.locator('main').getByRole('button', { name: /Christophersonwolf|ジョセフィーヌ/ }).first().waitFor();
    await check('M-21 確認待ちの予約');
    await page.locator('main').getByRole('button', { name: /Christophersonwolf|ジョセフィーヌ/ }).first().click();
    await page.getByRole('dialog').waitFor();
    await check('M-21 予約の内容(ダイアログ)');
    await page.getByRole('dialog').getByRole('button', { name: '閉じる' }).click();

    await page.goto('/admin/bookings/new');
    await page.getByRole('heading', { name: '予約を入れる' }).waitFor();
    const picker = page.getByRole('group', { name: '予約を入れるおうち' });
    await picker.getByRole('searchbox', { name: '探す言葉' }).fill(u.memberNo);
    await picker.getByRole('list', { name: '予約を入れるおうちの候補' }).getByRole('button', { name: new RegExp(u.memberNo) }).click();
    await page.getByRole('checkbox', { name: /Christophersonwolf/ }).check();
    await page.getByRole('tab', { name: 'お泊まり' }).click();
    await page.getByLabel('チェックインの日').fill(dayAhead(50));
    await page.getByLabel('チェックアウトの日').fill(dayAhead(52));
    await page.locator('.bk-adm-estimate').waitFor();
    await check('M-22 予約を入れる');

    await page.goto('/admin/dashboard');
    await page.getByRole('region', { name: '期間の集計' }).waitFor();
    await page.waitForLoadState('networkidle');
    await check('M-12 ダッシュボード');
    const cell = page.locator('.dsb-cal button').filter({ hasText: /\d/ }).first();
    if (await cell.count()) {
      await cell.click();
      await page.getByRole('dialog').waitFor();
      await check('M-12 ダッシュボード(日の詳細)');
      await page.getByRole('dialog').getByRole('button', { name: '閉じる' }).click();
    }

    await page.goto(`/admin/households/${hid}`);
    await page.getByRole('heading', { name: LONG_HOUSE }).waitFor();
    await check('M-05 おうちの詳細(長い呼び名)');

    await page.goto('/admin/settings');
    await page.getByRole('heading', { name: '設定' }).first().waitFor();
    await page.waitForLoadState('networkidle');
    await check('M-12 設定');
    await page.goto('/admin/booking-settings');
    await page.getByRole('region', { name: '受け入れる頭数' }).waitFor();
    await check('M-23 予約の設定');
    await page.close();
    log.report();
    expect(log.problems).toEqual([]);
  });
}

