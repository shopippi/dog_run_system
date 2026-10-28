import { expect, test } from '@playwright/test';

test('受付・管理画面が開く', async ({ page }) => {
  await page.goto('/admin/');
  await expect(page.getByRole('heading', { name: 'ドッグラン 受付・管理' })).toBeVisible();
});
