import { expect, test } from '@playwright/test';

test('お客さん向け画面が開く', async ({ page }) => {
  await page.goto('/liff/');
  await expect(page.getByText('グリーンドーム 会員証').first()).toBeVisible();
});
