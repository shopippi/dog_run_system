import { expect, test } from '@playwright/test';
import { adminLogin, adminToast, newLineUser, openLiff, registerViaUi } from './helpers';

test('A-03 ポイントを1つ手動で足し、結果を確かめてから登録し、操作ログから元に戻す', async ({ browser }) => {
  const customer = await browser.newPage();
  const user = newLineUser('パパ');
  await registerViaUi(customer, user, ['テンテン']);

  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await adminLogin(page, 'admin');
  await page.getByRole('link', { name: 'おうちを探す' }).click();
  await page.getByRole('searchbox', { name: '探す言葉' }).fill('てんてん');
  await page.getByRole('link', { name: 'テンテンのおうちの詳細を開く' }).click();

  await page.getByRole('button', { name: 'ポイント・無料券を登録' }).click();
  const dialog = page.getByRole('dialog', { name: 'ポイント・無料券の手動登録' });
  await expect(dialog.getByRole('button', { name: '内容を確かめる' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'ポイントを1ふやす' }).click();
  await dialog.getByRole('radio', { name: 'イベントの特典' }).check();
  await dialog.getByRole('button', { name: '内容を確かめる' }).click();

  const confirm = page.getByRole('dialog', { name: 'この内容で登録しますか' });
  await expect(confirm.getByRole('definition').first()).toHaveText('0 → 1');
  await expect(confirm).toContainText('イベントの特典');
  await confirm.getByRole('button', { name: '登録する' }).click();
  await expect(adminToast(page, 'いまは 1ポイント')).toBeVisible();
  const head = page.getByRole('region', { name: 'おうちの概要' });
  await expect(head.getByRole('group', { name: 'ポイント', exact: true })).toContainText('1ポイント');
  await expect(page.getByRole('list', { name: 'ポイントの記録' })).toContainText('イベントの特典');

  await openLiff(customer, user);
  await expect(customer.getByRole('img', { name: 'ポイント 1 / 10' })).toBeVisible();

  // 操作ログから元に戻す
  await page.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: '操作ログ' }).click();
  const row = page
    .getByRole('list', { name: '操作の一覧' })
    .getByRole('listitem')
    .filter({ hasText: 'テンテンのおうち' })
    .filter({ hasText: 'ポイント・無料券の手動登録' });
  await expect(row).toContainText('理由: イベントの特典');
  await row.getByRole('button', { name: '元に戻す' }).click();
  await page.getByRole('dialog', { name: '操作を元に戻す' }).getByRole('button', { name: '元に戻す' }).click();
  await expect(row.getByText('元に戻し済み')).toBeVisible();

  await openLiff(customer, user);
  await expect(customer.getByRole('img', { name: 'ポイント 0 / 10' })).toBeVisible();
});

test('A-03 減らしすぎは、確かめた時点で理由と次にすることを出す。「その他」は内容が要る', async ({ browser }) => {
  const customer = await browser.newPage();
  await registerViaUi(customer, newLineUser('ママ'), ['ピピン']);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await adminLogin(page, 'admin');
  await page.getByRole('link', { name: 'おうちを探す' }).click();
  await page.getByRole('searchbox', { name: '探す言葉' }).fill('ぴぴん');
  await page.getByRole('link', { name: 'ピピンのおうちの詳細を開く' }).click();
  await page.getByRole('button', { name: 'ポイント・無料券を登録' }).click();
  const dialog = page.getByRole('dialog', { name: 'ポイント・無料券の手動登録' });
  await dialog.getByRole('button', { name: 'ポイントを1へらす' }).click();
  await dialog.getByRole('radio', { name: 'その他' }).check();
  await expect(dialog.getByRole('button', { name: '内容を確かめる' })).toBeDisabled();
  await dialog.getByLabel('理由の内容').fill('数え間違い');
  await dialog.getByRole('button', { name: '内容を確かめる' }).click();
  await expect(dialog.getByRole('alert')).toContainText('ポイントは0しかないため、1ポイント減らせません。');
  await dialog.getByRole('button', { name: 'やめる' }).click();
  await expect(dialog).toHaveCount(0);
});
