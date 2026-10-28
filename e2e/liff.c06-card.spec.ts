import { expect, test } from '@playwright/test';
import { newLineUser, openCheckin, openLiff, registerViaUi } from './helpers';

test('C-06 会員証に、呼び名・会員ID・犬・ポイントが出て、チェックイン後は1つたまる', async ({ page }) => {
  const user = newLineUser('パパ');
  const memberNo = await registerViaUi(page, user, ['アル', 'ニコ']);
  await openLiff(page, user);

  const card = page.getByRole('region', { name: '会員証' });
  await expect(card.getByText('アル・ニコのおうち')).toBeVisible();
  await expect(card.getByText(memberNo)).toBeVisible();
  await expect(card.getByRole('img', { name: 'ポイント 0 / 10' })).toBeVisible();
  await expect(card.getByText('あと10ポイント')).toBeVisible();

  await openCheckin(page, user);
  await page.getByRole('button', { name: 'チェックインする' }).click();
  await page.getByRole('link', { name: '会員証にもどる' }).click();

  await expect(card.getByRole('img', { name: 'ポイント 1 / 10' })).toBeVisible();
  await expect(card.locator('.stamps span.on')).toHaveCount(1);
  await page.getByRole('button', { name: '今日のチェックインを見る' }).click();
  await expect(page.getByRole('region', { name: 'チェックイン完了' })).toBeVisible();
});
