import { expect, test } from '@playwright/test';
import { adminLogin } from './helpers';

test('S-01 ログインすると、名前と役割が出る。ログインは再読み込みしても保たれる', async ({ page }) => {
  await page.goto('/admin/');
  await expect(page.getByRole('heading', { name: 'ドッグラン 受付・管理' })).toBeVisible();

  await page.getByLabel('メールアドレス').fill('admin@example.com');
  await page.getByLabel('パスワード').fill('まちがい');
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.getByRole('alert')).toContainText('メールアドレスかパスワードが違います');

  await adminLogin(page, 'admin');
  await expect(page.getByText('管理者(管理者)')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'ログアウト' })).toBeVisible();

  await page.getByRole('button', { name: 'ログアウト' }).click();
  await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible();
});

test('S-01 製作者のアカウントでは「見るだけ」と表示する', async ({ page }) => {
  await adminLogin(page, 'developer');
  await expect(page.getByText('製作者のアカウントは見るだけです')).toBeVisible();
});
