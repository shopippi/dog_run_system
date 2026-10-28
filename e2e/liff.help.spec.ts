import { expect, test } from '@playwright/test';
import { newLineUser, openLiff, registerViaUi } from './helpers';

test('会員証から「使い方・よくある質問」を開き、知りたいことの答えを読める', async ({ page }) => {
  const user = newLineUser('ママ');
  await registerViaUi(page, user, ['アル']);
  await openLiff(page, user);
  await page.getByRole('link', { name: '使い方・よくある質問' }).click();
  await expect(page.getByRole('heading', { name: '使い方・よくある質問' })).toBeVisible();

  for (const q of ['ポイントはどうやってたまりますか?', '無料券はどうやって使いますか?', '家族も同じ会員証を使えますか?', 'ワンちゃんの写真や名前を変えたい', '前のポイントカードのポイントを引き継げますか?', '困ったときは?']) {
    await expect(page.getByText(q, { exact: true })).toBeVisible();
  }
  const answer = page.getByText(/10ポイントたまると、無料券が1枚もらえます/);
  await expect(answer).toBeHidden();
  await page.getByText('無料券はどうやって使いますか?').click();
  await expect(answer).toBeVisible();
  await page.getByText('困ったときは?').click();
  await expect(page.getByText(/受付のスタッフにお知らせください/)).toBeVisible();

  // ヘッダーから会員証に戻れる
  await page.getByRole('link', { name: '会員証' }).click();
  await expect(page.getByRole('region', { name: '会員証' })).toBeVisible();
});
