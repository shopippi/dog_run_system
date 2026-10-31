import { expect, test } from '@playwright/test';
import { adminLogin, newLineUser, openLiff } from './helpers';
import { bookDaycareApi, dayAhead, markExperienced, registerApi, requestDaycareViaUi, setOverride, showDateInCalendar } from './booking-helpers';

// C-15 予約する・C-16 予約の一覧とキャンセル(要件定義書 21章)。LIFF はモック

test('C-15 預かりの経験がある子は、予約するとすぐ確定する(料金の目安つき)', async ({ page, request }) => {
  const user = newLineUser('ラテママ');
  const u = await registerApi(request, user, [{ name: 'ラテアート' }]);
  await markExperienced(request, u.dogs[0]!.id);
  const date = dayAhead(3);

  await openLiff(page, user);
  await page.getByRole('link', { name: '預かり・お泊まりの予約' }).click();
  await page.getByRole('heading', { name: '預かり・お泊まりの予約' }).waitFor();
  await page.getByRole('button', { name: '予約する' }).click();
  await requestDaycareViaUi(page, date);
  const estimate = page.getByRole('region', { name: '料金の目安' });
  await expect(estimate).toContainText('3,000円');
  await expect(estimate).toContainText('目安。お支払いは受付で');
  await expect(page.getByText('「予約する」を押すと、予約が確定します。')).toBeVisible();
  await page.getByRole('button', { name: '予約する', exact: true }).click();

  await expect(page.getByRole('status')).toHaveText('予約が確定しました。');
  await expect(page.getByRole('heading', { name: '預かりの予約' })).toBeVisible();
  await expect(page.locator('.bk-detail-title .badge')).toHaveText('確定');
  await expect(page.getByText('ごはんは朝と夕方に1回ずつ')).toBeVisible();

  await page.getByRole('link', { name: '予約の一覧へ' }).click();
  const up = page.getByRole('region', { name: 'これからの予約' });
  await expect(up.getByRole('link', { name: /預かり/ })).toContainText('確定');
});

test('C-15 はじめての子は確認待ち → 管理者が承認 → お客さんの画面が確定になる', async ({ page, browser, request }) => {
  const user = newLineUser('モカパパ');
  await registerApi(request, user, [{ name: 'モカブレンド' }]);
  const date = dayAhead(4);

  await openLiff(page, user, '/bookings/new');
  await expect(page.getByText('はじめての子がいるので、お店が確認してから確定します。')).toBeVisible();
  await requestDaycareViaUi(page, date);
  await page.getByRole('button', { name: '予約する', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('予約を受け付けました。お店の確認をお待ちください。');
  await expect(page.locator('.bk-detail-title .badge')).toHaveText('確認待ち');
  await expect(page.getByText('はじめてのワンちゃんがいるため、お店が確認しています。')).toBeVisible();
  const url = page.url();

  // 管理者が確認待ちから承認する(お客さんへの一言つき)
  const admin = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await adminLogin(admin, 'admin', '/bookings/pending');
  await admin.getByRole('heading', { name: '確認待ちの予約' }).waitFor();
  await admin.getByRole('button', { name: /モカブレンド/ }).first().click();
  const dialog = admin.getByRole('dialog', { name: '預かりの予約' });
  await expect(dialog).toContainText('はじめての預かり');
  await dialog.getByRole('button', { name: '承認する' }).click();
  await dialog.getByLabel('お客さんへの一言(なくてもよい)').fill('当日お待ちしています');
  await dialog.getByRole('button', { name: '承認する' }).click();
  await expect(dialog.locator('.badge').first()).toHaveText('確定');
  await admin.close();

  await page.goto(url);
  await expect(page.locator('.bk-detail-title .badge')).toHaveText('確定');
  await expect(page.getByText('当日お待ちしています')).toBeVisible();
});

test('C-15 満員の日と休みの日は選べない(選んだワンちゃんのサイズで見る)', async ({ page, request }) => {
  const user = newLineUser('ハナママ');
  await registerApi(request, user, [{ name: 'ハナミズキ', size: 'large' }]);
  const full = dayAhead(5);
  const closed = dayAhead(6);
  await setOverride(request, { date: full, service: 'daycare', caps: { small: null, medium: null, large: 0 } });
  await setOverride(request, { date: closed, service: 'daycare', closed: true, note: '研修' });

  await openLiff(page, user, '/bookings/new');
  await page.getByRole('button', { name: '日にちを選ぶ' }).click();
  const fullCell = await showDateInCalendar(page, full);
  await expect(fullCell).toBeDisabled();
  await expect(fullCell).toHaveAttribute('data-status', 'full');
  await expect(fullCell).toContainText('満員');
  const closedCell = page.locator(`.bk-cal-cell[data-date="${closed}"]`);
  await expect(closedCell).toBeDisabled();
  await expect(closedCell).toContainText('休み');
  // 今日は選べない(初期値は翌日から)
  // 空いている日は選べる
  const open = page.locator(`.bk-cal-cell[data-date="${dayAhead(7)}"]`);
  if ((await open.count()) > 0) await expect(open).toBeEnabled();
});

test('C-16 期限まではキャンセルできる。キャンセルした予約は「キャンセル」になる', async ({ page, request }) => {
  const user = newLineUser('ココママ');
  const u = await registerApi(request, user, [{ name: 'ココナッツ' }]);
  const b = await bookDaycareApi(request, user, [u.dogs[0]!.id], dayAhead(8));
  await openLiff(page, user, `/bookings/${b.id}`);
  await expect(page.getByText(/キャンセルは .* までできます/)).toBeVisible();
  await page.getByRole('button', { name: 'この予約をキャンセルする' }).click();
  const sheet = page.getByRole('dialog', { name: '予約をキャンセルしますか' });
  await sheet.getByRole('button', { name: 'キャンセルする' }).click();
  await expect(page.getByRole('status')).toHaveText('予約をキャンセルしました。');
  await expect(page.locator('.bk-detail-title .badge')).toHaveText('キャンセル');
  await openLiff(page, user, '/bookings');
  await expect(page.getByRole('region', { name: 'これまでの予約' })).toContainText('キャンセル');
});
