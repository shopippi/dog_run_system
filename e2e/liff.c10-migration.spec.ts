import { expect, test } from '@playwright/test';
import { makePhoto, newLineUser, openLiff, registerViaUi } from './helpers';

test('C-10 旧カードの写真を撮って引き継ぎを申請し、申請の状態を見られる', async ({ page }) => {
  const user = newLineUser('ママ');
  await registerViaUi(page, user, ['アル']);
  await openLiff(page, user);
  await page.getByRole('link', { name: '旧カードの引き継ぎ' }).click();
  await expect(page.getByRole('heading', { name: '旧カードの引き継ぎ' })).toBeVisible();

  // 写真を付けずに申請すると、何が足りないかを出す
  await page.getByRole('radio', { name: 'LINEのショップカード' }).check();
  await page.getByRole('button', { name: '申請する' }).click();
  await expect(page.getByRole('alert')).toContainText('写真を付けてください');

  // 大きな写真(スマホのカメラ)は、長い辺 1200px に縮小して送る
  await page.locator('input[type=file]').setInputFiles({ name: 'card.jpg', mimeType: 'image/jpeg', buffer: await makePhoto(page, 4000, 3000) });
  const preview = page.getByRole('img', { name: '選んだカードの写真' });
  await expect(preview).toBeVisible();
  const size = await preview.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
  expect(size).toEqual([1200, 900]);

  await page.getByLabel('だいたいのポイント数').fill('たくさん');
  await page.getByRole('button', { name: '申請する' }).click();
  await expect(page.getByRole('alert')).toContainText('0から99まで');
  await page.getByLabel('だいたいのポイント数').fill('7');
  await page.getByLabel('メモ').fill('3年くらい使っていました');
  await page.getByRole('button', { name: '申請する' }).click();

  await expect(page.getByRole('status')).toContainText('申請しました');
  const history = page.getByRole('region', { name: '申請の状態' });
  await expect(history).toContainText('LINEのショップカード');
  await expect(history).toContainText('だいたい7ポイント');
  await expect(history).toContainText('確認待ち');

  // 申請したカードは、もう選べない。残りの紙のカードだけを申請できる
  await expect(page.getByRole('radio', { name: 'LINEのショップカード' })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: '紙のスタンプカード' })).toBeChecked();
  await page.locator('input[type=file]').setInputFiles({ name: 'paper.jpg', mimeType: 'image/jpeg', buffer: await makePhoto(page, 900, 1600) });
  await expect(page.getByRole('img', { name: '選んだカードの写真' })).toBeVisible();
  await page.getByRole('button', { name: '申請する' }).click();
  await expect(history).toContainText('紙のスタンプカード');
  await expect(page.getByText('引き継げるカードは、すべて申請済みです。')).toBeVisible();
  await expect(page.getByRole('button', { name: '申請する' })).toHaveCount(0);

  // 開き直しても状態が残っている
  await openLiff(page, user, '/migration');
  await expect(page.getByRole('region', { name: '申請の状態' }).getByText('確認待ち')).toHaveCount(2);
});
