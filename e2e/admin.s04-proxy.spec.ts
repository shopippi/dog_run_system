import { expect, test } from '@playwright/test';
import { adminLogin, newLineUser, openLiff, registerViaUi } from './helpers';

test('S-04 犬の名前で探して代理でチェックインすると、お客さんの会員証にポイントが付く', async ({ browser }) => {
  const customer = await browser.newPage();
  const user = newLineUser('おじいちゃん');
  await registerViaUi(customer, user, ['ゴン']);

  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await adminLogin(page, 'staff');
  await page.getByRole('link', { name: '代理チェックイン' }).click();
  await page.getByRole('searchbox', { name: '探す言葉' }).fill('ごん');
  await page.getByRole('list', { name: '見つかったおうち' }).getByRole('button', { name: /ゴンのおうち/ }).click();

  const panel = page.getByRole('group', { name: '代理チェックイン' });
  await expect(panel.getByRole('checkbox', { name: /ゴン/ })).toBeChecked();
  await panel.getByRole('button', { name: '代理でチェックインする' }).click();
  await expect(panel.getByRole('status')).toContainText('チェックインしました。1ポイントを付けました。');
  await expect(panel.getByRole('button', { name: '代理でチェックインする' })).toHaveCount(0);

  await page.getByRole('link', { name: '今日の来場' }).click();
  const row = page.getByRole('listitem', { name: /ゴン/ });
  await expect(row.getByText('受付で代理')).toBeVisible();

  await openLiff(customer, user);
  await expect(customer.getByRole('img', { name: 'ポイント 1 / 10' })).toBeVisible();
});

test('S-04 製作者には代理チェックインのメニューを出さない', async ({ page }) => {
  await adminLogin(page, 'developer');
  await expect(page.getByRole('link', { name: '代理チェックイン' })).toHaveCount(0);
});
