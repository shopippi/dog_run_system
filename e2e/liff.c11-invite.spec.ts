import { expect, test } from '@playwright/test';
import { newLineUser, openLiff, registerViaUi } from './helpers';

test('C-11 LINEのトークで招待を送れる。招待のQRコードも表示できる', async ({ page }) => {
  const user = newLineUser('ママ');
  await registerViaUi(page, user, ['アル', 'ニコ']);
  await openLiff(page, user);
  await page.getByRole('link', { name: '家族を招待' }).click();
  await expect(page.getByRole('heading', { name: '家族を招待' })).toBeVisible();

  await page.getByRole('button', { name: 'LINEで招待を送る' }).click();
  await expect(page.getByRole('status')).toContainText('招待を送りました');
  const messages = await page.evaluate(() => (window as unknown as { __sharedMessages: string[] }).__sharedMessages);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain('アル・ニコのおうちの会員証に招待します');
  expect(messages[0]).toMatch(/\/liff\/invite\/[A-Za-z0-9_-]{22}/);

  await page.getByRole('button', { name: '招待のQRコードを表示する' }).click();
  await expect(page.getByRole('img', { name: '家族の招待のQRコード' })).toBeVisible();
});
