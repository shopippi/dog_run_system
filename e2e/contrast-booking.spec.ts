import { expect, test, type Page } from '@playwright/test';
import { lowContrast } from './households-helpers';
import { adminLogin, newLineUser, openLiff } from './helpers';
import { adminApiLogin, bookDaycareApi, dayAhead, jstToday, markExperienced, registerApi, setOverride, showDateInCalendar } from './booking-helpers';

// 預かり・お泊まりの予約の画面(L-14・L-15・M-20〜M-23)の、文字と背景のコントラスト(4.5:1。ライトとダーク)
const PHONE = { viewport: { width: 393, height: 759 }, isMobile: true, hasTouch: true };
const TABLET = { viewport: { width: 1024, height: 768 }, hasTouch: true };

async function check(page: Page, screen: string) {
  await page.waitForLoadState('networkidle');
  expect(await lowContrast(page), screen).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme === 'light' ? 'ライト' : 'ダーク', () => {
    test('予約の画面(お客さん)の文字が背景に対して読める', async ({ browser, request }) => {
      test.setTimeout(120_000);
      const offset = scheme === 'light' ? 40 : 50;
      const user = newLineUser('ママ');
      const u = await registerApi(request, user, [{ name: 'アルデンテ' }, { name: 'ニコライ', size: 'large' }]);
      await markExperienced(request, u.dogs[0]!.id);
      await setOverride(request, { date: dayAhead(offset + 1), service: 'daycare', closed: true });
      await setOverride(request, { date: dayAhead(offset + 2), service: 'daycare', caps: { small: 0, medium: null, large: 0 } });
      const b = await bookDaycareApi(request, user, [u.dogs[0]!.id], dayAhead(offset + 3));

      const page = await browser.newPage({ ...PHONE, colorScheme: scheme });
      await openLiff(page, user, '/bookings');
      await page.getByRole('region', { name: 'これからの予約' }).waitFor();
      await check(page, 'L-15 予約の一覧');
      await page.getByRole('button', { name: '予約する' }).click();
      await page.getByRole('checkbox', { name: /ニコライ/ }).check();
      await check(page, 'L-14 種類とワンちゃん');
      await page.getByRole('button', { name: '日にちを選ぶ' }).click();
      await (await showDateInCalendar(page, dayAhead(offset))).click();
      await check(page, 'L-14 空きのカレンダー');
      await page.getByRole('button', { name: '次へ' }).click();
      for (const box of await page.locator('.bk-check input[type=checkbox]').all()) await box.check();
      await check(page, 'L-14 メモと確かめること');
      await page.getByRole('button', { name: '内容を確かめる' }).click();
      await page.getByRole('region', { name: '料金の目安' }).waitFor();
      await check(page, 'L-14 内容の確認');
      await openLiff(page, user, `/bookings/${b.id}`);
      await expect(page.locator('.bk-detail-title .badge')).toHaveText('確定');
      await check(page, 'L-15 予約の内容');
      await page.close();
    });

    test('予約の画面(管理画面)の文字が背景に対して読める', async ({ browser, request }) => {
      test.setTimeout(120_000);
      const date = dayAhead(scheme === 'light' ? 44 : 45);
      const user = newLineUser('パパ');
      const u = await registerApi(request, user, [{ name: 'ペコリーノ' }]);
      await bookDaycareApi(request, user, [u.dogs[0]!.id], date);
      await adminApiLogin(request, 'staff');
      const hh = (await (await request.get(`/admin/api/households?q=${u.memberNo}`)).json()).households[0].id;
      await request.post('/admin/api/bookings', {
        headers: { 'x-dr-admin': '1' },
        data: { householdId: hh, dogIds: [u.dogs[0]!.id], service: 'daycare', startDate: jstToday(), endDate: jstToday(), startTime: '10:00', endTime: '15:00' },
      });
      const page = await browser.newPage({ ...TABLET, colorScheme: scheme });
      await adminLogin(page, 'admin', `/bookings?service=daycare&date=${date}`);
      const panel = page.getByRole('region', { name: /の預かり$/ });
      await panel.locator('.bk-adm-list').getByRole('button', { name: /ペコリーノ/ }).waitFor();
      await check(page, 'M-20 予約カレンダー');
      await page.getByRole('tab', { name: '週' }).click();
      await page.locator('.bk-chip').first().waitFor();
      await check(page, 'M-20 予約カレンダー(週)');
      await page.goto('/admin/bookings/pending');
      await page.getByRole('button', { name: /ペコリーノ/ }).first().click();
      await page.getByRole('dialog', { name: '預かりの予約' }).waitFor();
      await check(page, 'M-21 予約の内容');
      await page.getByRole('dialog', { name: '預かりの予約' }).getByRole('button', { name: '閉じる' }).click();
      await page.goto('/admin/bookings/new');
      await page.getByRole('group', { name: '予約を入れるおうち' }).getByRole('searchbox', { name: '探す言葉' }).fill(u.memberNo);
      await page.getByRole('list', { name: '予約を入れるおうちの候補' }).getByRole('button', { name: new RegExp(u.memberNo) }).click();
      await page.locator('.bk-adm-estimate').waitFor();
      await check(page, 'M-22 予約を入れる');
      await page.goto('/admin/');
      await page.getByRole('region', { name: '今日の預け・お迎え' }).getByRole('button').first().waitFor();
      await check(page, 'M-02 今日の預け・お迎え');
      await page.goto('/admin/booking-settings');
      await page.getByRole('region', { name: '受け入れる頭数' }).waitFor();
      await check(page, 'M-23 予約の設定');
      await page.close();
    });
  });
}
