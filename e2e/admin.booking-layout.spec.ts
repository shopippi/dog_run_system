import { expect, test } from '@playwright/test';
import { checkScreen } from './households-helpers';
import { adminLogin, newLineUser } from './helpers';
import { adminApiLogin, bookDaycareApi, dayAhead, jstToday, markExperienced, registerApi } from './booking-helpers';

// M-20 予約カレンダー・M-21 確認待ち・M-22 予約を入れる・M-23 予約の設定の見え方。PC(1280)とタブレット縦(768)。
const VIEWPORTS = [
  { name: '1280x800', viewport: { width: 1280, height: 800 }, touch: false, offset: 30 },
  { name: '768x1024', viewport: { width: 768, height: 1024 }, touch: true, offset: 32 },
] as const;

for (const v of VIEWPORTS) {
  test(`${v.name}: 予約の画面が横にはみ出さず、押しやすい大きさになっている`, async ({ browser, request }) => {
    test.setTimeout(150_000);
    const date = dayAhead(v.offset);
    const user = newLineUser('ジョセフィーヌママ');
    const u = await registerApi(request, user, [{ name: 'ジョセフィーヌ' }, { name: 'マルゲリータ', size: 'large' }]);
    await markExperienced(request, u.dogs[0]!.id);
    await bookDaycareApi(request, user, [u.dogs[0]!.id], date, { note: '朝ごはんは食べてきます。お薬はありません。' });
    const p = newLineUser('はじめての子');
    const pu = await registerApi(request, p, [{ name: 'ニコラス', size: 'medium' }]);
    await bookDaycareApi(request, p, [pu.dogs[0]!.id], date);

    await adminApiLogin(request, 'admin');
    const page = await browser.newPage({ viewport: v.viewport, hasTouch: v.touch });
    await adminLogin(page, 'admin', `/bookings?service=daycare&date=${date}`);
    await page.getByRole('heading', { name: '予約カレンダー' }).waitFor();
    const panel = page.getByRole('region', { name: /の預かり$/ });
    await panel.locator('.bk-adm-list').getByRole('button', { name: /ジョセフィーヌ/ }).waitFor();
    await checkScreen(page, v.name, 'M-20 予約カレンダー(月と日のパネル)', v.touch);
    await panel.getByText('この日の受け入れる頭数を変える').click();
    await checkScreen(page, v.name, 'M-20 予約カレンダー(その日の受け入れ数)', v.touch);
    await page.getByRole('tab', { name: '週' }).click();
    await page.locator('.bk-chip').first().waitFor();
    await checkScreen(page, v.name, 'M-20 予約カレンダー(週)', v.touch);
    await page.getByRole('tab', { name: 'お泊まり' }).click();
    await checkScreen(page, v.name, 'M-20 予約カレンダー(お泊まり)', v.touch);

    await page.goto('/admin/bookings/pending');
    await page.getByRole('heading', { name: '確認待ちの予約' }).waitFor();
    await page.getByRole('button', { name: /ニコラス/ }).first().waitFor();
    await checkScreen(page, v.name, 'M-21 確認待ちの予約', v.touch);
    await page.getByRole('button', { name: /ニコラス/ }).first().click();
    const dialog = page.getByRole('dialog', { name: '預かりの予約' });
    await expect(dialog.getByRole('button', { name: '閉じる' })).toBeFocused();
    await checkScreen(page, v.name, 'M-21 予約の内容(確認待ち)', v.touch);
    await dialog.getByRole('button', { name: 'お断りする' }).click();
    await checkScreen(page, v.name, 'M-21 予約のお断り(一言)', v.touch);
    await dialog.getByRole('button', { name: 'やめる' }).click();
    await dialog.getByRole('button', { name: '閉じる' }).click();

    await page.goto('/admin/bookings/new');
    await page.getByRole('heading', { name: '予約を入れる' }).waitFor();
    await checkScreen(page, v.name, 'M-22 予約を入れる(おうちを選ぶ)', v.touch);
    const picker = page.getByRole('group', { name: '予約を入れるおうち' });
    await picker.getByRole('searchbox', { name: '探す言葉' }).fill(u.memberNo);
    await picker.getByRole('list', { name: '予約を入れるおうちの候補' }).getByRole('button', { name: new RegExp(u.memberNo) }).click();
    await page.getByRole('checkbox', { name: /マルゲリータ/ }).check();
    await page.getByRole('tab', { name: 'お泊まり' }).click();
    await page.getByLabel('チェックインの日').fill(dayAhead(v.offset + 1));
    await page.getByLabel('チェックアウトの日').fill(dayAhead(v.offset + 3));
    await page.locator('.bk-adm-estimate').waitFor();
    await checkScreen(page, v.name, 'M-22 予約を入れる(入力と料金の目安)', v.touch);

    // 今日の来場の「今日の預け・お迎え」(受付で今日の予約を入れる)
    await request.post('/admin/api/bookings', {
      headers: { 'x-dr-admin': '1' },
      data: { householdId: (await (await request.get(`/admin/api/households?q=${u.memberNo}`)).json()).households[0].id, dogIds: [u.dogs[1]!.id], service: 'daycare', startDate: jstToday(), endDate: jstToday(), startTime: '09:30', endTime: '17:00', note: 'お薬を1日1回' },
    });
    await page.goto('/admin/');
    await page.getByRole('region', { name: '今日の預け・お迎え' }).getByRole('button').first().waitFor();
    await checkScreen(page, v.name, 'M-02 今日の来場(今日の預け・お迎え)', v.touch);

    await page.goto('/admin/booking-settings');
    await page.getByRole('heading', { name: '予約の設定' }).waitFor();
    await page.getByRole('region', { name: '受け入れる頭数' }).waitFor();
    await checkScreen(page, v.name, 'M-23 予約の設定', v.touch);
    await page.close();
  });
}
