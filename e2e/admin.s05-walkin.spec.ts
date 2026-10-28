import { expect, test } from '@playwright/test';
import { adminLogin } from './helpers';

test('S-05 会員以外のお客さんの頭数を記録すると、今日の来場と集計に出る', async ({ page }) => {
  await adminLogin(page, 'staff');
  const before = Number((await page.locator('.kpi', { hasText: 'うち会員以外' }).locator('.v').textContent())!.replace('頭', ''));

  const form = page.getByRole('region', { name: '会員以外のお客さん' });
  await form.getByRole('button', { name: '1頭ふやす' }).click();
  await form.getByRole('button', { name: '1頭ふやす' }).click();
  await expect(form.getByText('3頭')).toBeVisible();
  await form.getByRole('button', { name: '記録する' }).click();
  await expect(form.getByRole('status')).toHaveText('会員以外のお客さん 3頭 を記録しました。');

  await expect(page.locator('.kpi', { hasText: 'うち会員以外' }).locator('.v')).toHaveText(`${before + 3}頭`);
  await expect(page.getByRole('list', { name: '今日の来場' }).getByText('会員以外 3頭').first()).toBeVisible();
});
