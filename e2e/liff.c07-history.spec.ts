import { expect, test } from '@playwright/test';
import { checkinOn } from './customer-helpers';
import { newLineUser, openLiff, registerViaUi } from './helpers';

test('C-07 来場履歴を月ごとに見られ、20件より前は「もっと前」で読める', async ({ page, request }) => {
  const user = newLineUser('ママ');
  await registerViaUi(page, user, ['アル', 'ニコ']);
  // 9/10〜10/1 の 22 日分。10ポイント目(9/19)と20ポイント目(9/29)で無料券が出て、9/20 に1枚使う
  const dates = Array.from({ length: 22 }, (_, i) => new Date(Date.UTC(2026, 8, 10 + i)).toISOString().slice(0, 10));
  for (const d of dates) await checkinOn(request, user, d, d === '2026-09-20');

  await openLiff(page, user);
  await page.getByRole('link', { name: '来場履歴' }).click();
  await expect(page.getByRole('heading', { name: '来場履歴' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '2026年10月' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '2026年9月' })).toBeVisible();
  await expect(page.locator('.hist-row')).toHaveCount(20);
  const first = page.locator('.hist-row').first();
  await expect(first).toContainText('アル・ニコ');
  await expect(first).toContainText('あなた');
  await expect(first).toContainText('+1ポイント');

  await page.getByRole('button', { name: 'もっと前の来場を見る' }).click();
  await expect(page.locator('.hist-row')).toHaveCount(22);
  await expect(page.getByRole('button', { name: 'もっと前の来場を見る' })).toHaveCount(0);
  const sept = page.getByRole('region', { name: '2026年9月' });
  await expect(sept.locator('.hist-row').filter({ hasText: '無料券を使用' })).toHaveCount(1);
  await expect(sept.locator('.hist-row').filter({ hasText: '無料券をもらった' })).toHaveCount(2);
  await expect(page.getByRole('heading', { name: '2026年9月' })).toHaveCount(1);
});

test('C-07 まだ来場がないときは、そのことを出す', async ({ page }) => {
  const user = newLineUser('パパ');
  await registerViaUi(page, user, ['モモ']);
  await openLiff(page, user, '/history');
  await expect(page.getByText('まだ来場の記録がありません。')).toBeVisible();
});
