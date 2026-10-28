import { expect, test } from '@playwright/test';
import { adminLogin, newLineUser, openLiff } from './helpers';

// 担当I: 施設の名前(設定 facility_name。docs/changes-2026-10-28.md 1章、docs/design.md 5章・6章)。
// 画面の名前は「グリーンドーム 会員証」「グリーンドーム 受付・管理」。ルールの設定で変えられる。

test('施設の名前は初期値「グリーンドーム」。お客さんのヘッダー・ログイン・管理画面の左上とタブの名前に出る', async ({ page, browser }) => {
  await page.goto('/admin/');
  await expect(page.getByRole('heading', { name: 'グリーンドーム 受付・管理' })).toBeVisible();
  await expect(page).toHaveTitle('グリーンドーム 受付・管理');

  const customer = await browser.newPage();
  await openLiff(customer, newLineUser('ママ'));
  await expect(customer.locator('.app-title')).toHaveText('グリーンドーム 会員証');
  await expect(customer).toHaveTitle('グリーンドーム 会員証');
  await customer.close();
});

test('A-12 管理者が施設の名前を変えると、管理画面とお客さんの画面の名前が変わる', async ({ page, browser }) => {
  await adminLogin(page, 'admin', '/settings');
  const section = page.getByRole('region', { name: '施設の名前' });
  const input = section.getByLabel('施設の名前');
  await expect(input).toHaveValue('グリーンドーム');
  try {
    await input.fill('みどりの森');
    await section.getByRole('button', { name: '保存する' }).click();
    await expect(section.getByText('保存しました')).toBeVisible();
    // 保存したら、左上の名前もすぐ変わる
    await expect(page.locator('.side-brand')).toHaveText('みどりの森 受付・管理');

    const customer = await browser.newPage();
    const user = newLineUser('パパ');
    await openLiff(customer, user);
    await expect(customer.locator('.app-title')).toHaveText('みどりの森 会員証');
    await customer.close();
  } finally {
    await page.reload();
    await section.getByLabel('施設の名前').fill('グリーンドーム');
    await section.getByRole('button', { name: '保存する' }).click();
    await expect(section.getByText('保存しました')).toBeVisible();
  }
});

test('製作者は施設の名前を見るだけで、変えられない', async ({ page }) => {
  await adminLogin(page, 'developer', '/settings');
  const section = page.getByRole('region', { name: '施設の名前' });
  await expect(section.getByLabel('施設の名前')).toBeDisabled();
  await expect(section.getByRole('button', { name: '保存する' })).toHaveCount(0);
});
