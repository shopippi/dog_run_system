import { expect, test } from '@playwright/test';
import { adminLogin, adminToast, newLineUser } from './helpers';
import { bookDaycareApi, dayAhead, jstToday, markExperienced, registerApi } from './booking-helpers';

// A-18 予約カレンダー・A-19 確認待ち・A-20 手入力・A-21 状態の変更(要件定義書 21章)

test('A-20 手入力: 電話の予約を入れる。いっぱいの日は知らせ、管理者は理由を書いて入れられる', async ({ page, request }) => {
  test.setTimeout(90_000);
  const date = dayAhead(10);
  // 大型の枠(2頭)を、ほかの2軒の予約でいっぱいにする
  for (const name of ['ラブA', 'ラブB']) {
    const user = newLineUser(`${name}ママ`);
    const u = await registerApi(request, user, [{ name, size: 'large' }]);
    await markExperienced(request, u.dogs[0]!.id);
    expect((await bookDaycareApi(request, user, [u.dogs[0]!.id], date)).status).toBe('confirmed');
  }
  const third = await registerApi(request, newLineUser('ゴンパパ'), [{ name: 'ゴンザブロウ', size: 'large' }]);

  await adminLogin(page, 'admin', '/bookings/new');
  await page.getByRole('heading', { name: '予約を入れる' }).waitFor();
  const picker = page.getByRole('group', { name: '予約を入れるおうち' });
  await picker.getByRole('searchbox', { name: '探す言葉' }).fill(third.memberNo);
  await picker.getByRole('list', { name: '予約を入れるおうちの候補' }).getByRole('button', { name: new RegExp(third.memberNo) }).click();
  await expect(page.getByRole('checkbox', { name: /ゴンザブロウ/ })).toBeChecked();
  await page.getByLabel('日にち').fill(date);
  await page.getByLabel('受付のメモ').fill('電話で受けた');
  await expect(page.locator('.bk-adm-estimate')).toContainText('5,000円');
  await page.getByRole('button', { name: '予約を入れる' }).click();

  const warn = page.getByRole('alert').filter({ hasText: '受け入れる頭数を超えます。' });
  await expect(warn).toContainText('大型: いま 2頭 / 受け入れ 2頭');
  await expect(page.getByRole('button', { name: '理由を書いて予約を入れる' })).toBeDisabled();
  await page.getByLabel('それでも入れる理由(管理者)').fill('常連さんで、スタッフを増やして対応する');
  await page.getByRole('button', { name: '理由を書いて予約を入れる' }).click();
  await expect(adminToast(page, /の預かりの予約を入れました。/)).toBeVisible();
  // カレンダーのその日に移る。大型は 3/2
  await page.getByRole('heading', { name: '予約カレンダー' }).waitFor();
  const panel = page.getByRole('region', { name: /の預かり$/ });
  await expect(panel.locator('.bk-usage')).toContainText('大 3/2');
  await expect(panel.locator('.bk-adm-list').getByRole('button', { name: /ゴンザブロウ/ })).toBeVisible();
});

test('A-20 受付スタッフは、いっぱいの日に入れられない(管理者に相談)', async ({ page, request }) => {
  const date = dayAhead(11);
  const fill = await registerApi(request, newLineUser('大きい子'), [
    { name: 'ラブC', size: 'large' },
    { name: 'ラブD', size: 'large' },
  ]);
  await adminLogin(page, 'staff', '/bookings/new');
  // 受付スタッフも手入力はできる
  const picker = page.getByRole('group', { name: '予約を入れるおうち' });
  await picker.getByRole('searchbox', { name: '探す言葉' }).fill(fill.memberNo);
  await picker.getByRole('list', { name: '予約を入れるおうちの候補' }).getByRole('button', { name: new RegExp(fill.memberNo) }).click();
  await page.getByRole('checkbox', { name: /ラブC/ }).check();
  await page.getByRole('checkbox', { name: /ラブD/ }).check();
  await page.getByLabel('日にち').fill(date);
  await page.getByRole('button', { name: '予約を入れる' }).click();
  await expect(adminToast(page, /予約を入れました。/)).toBeVisible();

  const other = await registerApi(request, newLineUser('もう1頭'), [{ name: 'ラブE', size: 'large' }]);
  await page.goto('/admin/bookings/new');
  await page.getByRole('group', { name: '予約を入れるおうち' }).getByRole('searchbox', { name: '探す言葉' }).fill(other.memberNo);
  await page.getByRole('list', { name: '予約を入れるおうちの候補' }).getByRole('button', { name: new RegExp(other.memberNo) }).click();
  await page.getByLabel('日にち').fill(date);
  await page.getByRole('button', { name: '予約を入れる' }).click();
  const warn = page.getByRole('alert').filter({ hasText: '受け入れる頭数を超えます。' });
  await expect(warn).toContainText('別の日にするか、管理者に相談してください。');
  await expect(page.getByLabel('それでも入れる理由(管理者)')).toHaveCount(0);
  // 予約の設定は管理者だけ(メニューに出ない)
  await expect(page.getByRole('link', { name: '予約の設定' })).toHaveCount(0);
});

test('A-18・A-21 カレンダーから予約を開き、利用開始 → 利用済み。確認待ちの数がメニューに出る', async ({ page, request }) => {
  const date = dayAhead(12);
  const user = newLineUser('ポチママ');
  const u = await registerApi(request, user, [{ name: 'ポチタロウ' }]);
  await markExperienced(request, u.dogs[0]!.id);
  await bookDaycareApi(request, user, [u.dogs[0]!.id], date);
  // 確認待ちを1件(はじめての子)
  const tamaUser = newLineUser('タマパパ');
  const tama = await registerApi(request, tamaUser, [{ name: 'タマサブロウ' }]);
  expect((await bookDaycareApi(request, tamaUser, [tama.dogs[0]!.id], date)).status).toBe('pending');

  await adminLogin(page, 'staff', `/bookings?service=daycare&date=${date}`);
  await page.getByRole('heading', { name: '予約カレンダー' }).waitFor();
  const panel = page.getByRole('region', { name: /の預かり$/ });
  await panel.locator('.bk-adm-list').getByRole('button', { name: /ポチタロウ/ }).click();
  const dialog = page.getByRole('dialog', { name: '預かりの予約' });
  await expect(dialog.locator('.bk-adm-estimate')).toContainText('目安。お支払いは受付で');
  await dialog.getByRole('button', { name: '利用開始にする' }).click();
  await expect(dialog.locator('.badge').first()).toHaveText('お預かり中');
  await dialog.getByRole('button', { name: '利用済みにする' }).click();
  await expect(dialog.locator('.badge').first()).toHaveText('利用済み');
  await dialog.getByRole('button', { name: '閉じる' }).click();
  await expect(panel.locator('.bk-adm-list').getByRole('button', { name: /ポチタロウ/ })).toContainText('利用済み');
  await expect(panel.locator('.bk-adm-list').getByRole('button', { name: /タマサブロウ/ })).toContainText('確認待ち');
  await expect(page.locator('.nav-badge')).not.toHaveText('0');
});

test('A-19 確認待ちをお断りする(お客さんへの一言)。製作者は見るだけ', async ({ page, browser, request }) => {
  const date = dayAhead(13);
  const user = newLineUser('チョコママ');
  const u = await registerApi(request, user, [{ name: 'チョコチップ' }]);
  expect((await bookDaycareApi(request, user, [u.dogs[0]!.id], date)).status).toBe('pending');

  // 製作者は開けるが、操作のボタンはない
  const dev = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await adminLogin(dev, 'developer', '/bookings/pending');
  await dev.getByRole('button', { name: /チョコチップ/ }).first().click();
  const devDialog = dev.getByRole('dialog', { name: '預かりの予約' });
  await expect(devDialog.getByRole('button', { name: '閉じる' })).toBeVisible();
  await expect(devDialog.getByRole('button', { name: '承認する' })).toHaveCount(0);
  await expect(devDialog.getByRole('button', { name: 'お断りする' })).toHaveCount(0);
  await dev.close();

  await adminLogin(page, 'admin', '/bookings/pending');
  await expect(page.locator('.nav-badge')).toBeVisible();
  await page.getByRole('button', { name: /チョコチップ/ }).first().click();
  const dialog = page.getByRole('dialog', { name: '預かりの予約' });
  await dialog.getByRole('button', { name: 'お断りする' }).click();
  await dialog.getByLabel('お客さんへの一言(なくてもよい)').fill('その日は貸し切りのため、お受けできません');
  await dialog.getByRole('button', { name: 'お断りする' }).click();
  await expect(dialog.locator('.badge').first()).toHaveText('お断り');
  await expect(dialog).toContainText('お断り: 送っていません');
});

test('A-20・A-18 受付スタッフは今日の予約を入れられる。今日の来場と予約カレンダーに「預け・お迎え」が時刻の順に出る。預けの時間と定休日が見える', async ({ page, browser, request }) => {
  const today = jstToday();
  const u = await registerApi(request, newLineUser('カシワモチノスケママ'), [{ name: 'カシワモチノスケ', size: 'medium' }]);
  await adminLogin(page, 'staff', '/bookings/new');
  const picker = page.getByRole('group', { name: '予約を入れるおうち' });
  await picker.getByRole('searchbox', { name: '探す言葉' }).fill(u.memberNo);
  await picker.getByRole('list', { name: '予約を入れるおうちの候補' }).getByRole('button', { name: new RegExp(u.memberNo) }).click();
  await page.getByLabel('日にち').fill(today);
  await page.getByLabel('預ける時刻').selectOption('09:00');
  await page.getByLabel('お迎えの時刻').selectOption('12:30');
  await page.getByLabel('お客さんからのメモ(ごはん・お薬・体調など)').fill('お昼ごはんあり');
  await expect(page.locator('.err-text')).toHaveCount(0);
  await page.getByRole('button', { name: '予約を入れる' }).click();
  await expect(adminToast(page, /予約を入れました。/)).toBeVisible();
  await expect(page.getByTestId('booking-hours')).toContainText('預け・お迎え 9:00〜18:00 / 定休日 なし');

  await page.goto('/admin/');
  const sched = page.getByRole('region', { name: '今日の預け・お迎え' });
  const rows = sched.getByRole('button', { name: /カシワモチノスケ/ });
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAccessibleName(/^9:00 預け カシワモチノスケ/);
  await expect(rows.nth(1)).toHaveAccessibleName(/^12:30 お迎え カシワモチノスケ/);
  await expect(rows.nth(0)).toContainText('カシワモチノスケ(プードル・中型)');
  await expect(rows.nth(0)).toContainText('お昼ごはんあり');

  // 製作者も見られる(見るだけ)
  const dev = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await adminLogin(dev, 'developer', '/');
  await expect(dev.getByRole('region', { name: '今日の預け・お迎え' }).getByRole('button', { name: /カシワモチノスケ/ })).toHaveCount(2);
  await dev.close();
});

test('A-19 承認するときに「預かり経験あり」にでき、次の予約はすぐ確定する', async ({ page, request }) => {
  const user = newLineUser('ワラビモチノスケママ');
  const u = await registerApi(request, user, [{ name: 'ワラビモチノスケ' }]);
  expect((await bookDaycareApi(request, user, [u.dogs[0]!.id], dayAhead(14))).status).toBe('pending');
  await adminLogin(page, 'admin', '/bookings/pending');
  await page.getByRole('button', { name: /ワラビモチノスケ/ }).first().click();
  const dialog = page.getByRole('dialog', { name: '預かりの予約' });
  await dialog.getByRole('button', { name: '承認する' }).click();
  await dialog.getByLabel('ワラビモチノスケを預かり経験ありにする').check();
  await dialog.getByRole('button', { name: '承認する' }).click();
  await expect(adminToast(page, /ワラビモチノスケを預かり経験ありにしました。/)).toBeVisible();
  expect((await bookDaycareApi(request, user, [u.dogs[0]!.id], dayAhead(15))).status).toBe('confirmed');
});
