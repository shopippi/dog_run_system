import { expect, test } from '@playwright/test';
import { newLineUser, openLiff } from './helpers';

test('C-01 はじめての人は同意画面から登録し、会員IDが発行される', async ({ page }) => {
  const user = newLineUser('パパ');
  await openLiff(page, user);

  await expect(page.getByRole('heading', { name: 'はじめての方へ' })).toBeVisible();
  const next = page.getByRole('button', { name: '同意して次へ' });
  await expect(next).toBeDisabled();
  await page.getByLabel('利用規約とプライバシーポリシーに同意します').check();
  await next.click();

  await expect(page.getByText('登録が完了しました')).toBeVisible();
  await expect(page.locator('.welcome-card .id')).toHaveText(/^DR-\d{6}$/);
  const memberNo = await page.locator('.welcome-card .id').textContent();

  await page.getByRole('button', { name: '会員証を見る' }).click();
  await expect(page.getByText(memberNo!)).toBeVisible();

  // もう一度開いても、同意画面は出ない
  await openLiff(page, user);
  await expect(page.getByText(memberNo!)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'はじめての方へ' })).toHaveCount(0);
});
