import { expect, test } from '@playwright/test';
import { adminLogin, newLineUser, openCheckin, registerViaUi } from './helpers';

test('S-06 犬の名前(ひらがな)でおうちを探せる。写真で探すでは最近来た犬が並ぶ', async ({ browser }) => {
  const customer = await browser.newPage();
  const user = newLineUser('パパ');
  const memberNo = await registerViaUi(customer, user, ['ラテ', 'モカ']);
  await openCheckin(customer, user);
  await customer.getByRole('button', { name: 'チェックインする' }).click();
  await customer.getByRole('region', { name: 'チェックイン完了' }).waitFor();

  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await adminLogin(page, 'staff', '/search');
  await page.getByRole('link', { name: 'おうちを探す' }).click();
  await page.getByRole('searchbox', { name: '探す言葉' }).fill('もか');
  const results = page.getByRole('list', { name: '見つかったおうち' });
  await expect(results.getByText('ラテ・モカのおうち')).toBeVisible();
  await results.getByRole('button', { name: /ラテ・モカのおうち/ }).click();
  const card = page.getByRole('region', { name: 'ラテ・モカのおうちの内容' });
  await expect(card.getByText(memberNo)).toBeVisible();

  await page.getByRole('tab', { name: '写真で探す' }).click();
  const grid = page.getByRole('list', { name: '最近来たワンちゃん' });
  await expect(grid.getByText('モカ', { exact: true })).toBeVisible();
  await grid.getByRole('button', { name: /モカ/ }).first().click();
  await expect(page.getByRole('region', { name: 'ラテ・モカのおうちの内容' })).toBeVisible();
});

test('S-06 見つからないときは、次にどうするかを出す', async ({ page }) => {
  await adminLogin(page, 'admin', '/search');
  await page.getByRole('link', { name: 'おうちを探す' }).click();
  await page.getByRole('searchbox', { name: '探す言葉' }).fill('そんななまえはいない');
  await expect(page.getByText('見つかりませんでした。別の言葉や、会員IDで探してみてください。')).toBeVisible();
});
