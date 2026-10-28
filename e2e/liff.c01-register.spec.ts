import { expect, test } from '@playwright/test';
import { newLineUser, openLiff, registerViaUi } from './helpers';

test('C-01 はじめての人は同意画面から登録し、会員IDが発行される', async ({ page }) => {
  const user = newLineUser('パパ');
  await openLiff(page, user);

  await expect(page.getByRole('heading', { name: 'はじめての方へ' })).toBeVisible();
  await expect(page.getByRole('button', { name: '同意して次へ' })).toBeDisabled();

  const memberNo = await registerViaUi(page, user);
  expect(memberNo).toMatch(/^DR-\d{6}$/);

  await page.getByRole('button', { name: '会員証を見る' }).click();
  await expect(page.getByText(memberNo)).toBeVisible();

  // もう一度開いても、同意画面は出ない
  await openLiff(page, user);
  await expect(page.getByText(memberNo)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'はじめての方へ' })).toHaveCount(0);
});
