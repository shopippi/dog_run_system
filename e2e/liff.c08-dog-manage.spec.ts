import { expect, test } from '@playwright/test';
import { makePhoto, newLineUser, openLiff, registerViaUi } from './helpers';

test('C-08 犬の追加・名前と写真の変更・登録のおやすみと戻すことができる', async ({ page }) => {
  const user = newLineUser('パパ');
  await registerViaUi(page, user, ['アル']);
  await openLiff(page, user, '/dogs');
  await expect(page.getByRole('heading', { name: 'ワンちゃん' })).toBeVisible();

  // 追加
  await page.getByRole('link', { name: 'ワンちゃんを追加する' }).click();
  const form = page.locator('fieldset.dog-form');
  await form.getByLabel('名前').fill('ニコ');
  await form.getByRole('combobox', { name: /犬種/ }).selectOption({ label: 'ポメラニアン' });
  await page.getByRole('button', { name: '追加する' }).click();
  await expect(page.getByRole('link', { name: /ニコ/ })).toBeVisible();

  // 名前と写真の変更(犬種とサイズは変えられない)
  await page.getByRole('link', { name: /アル/ }).click();
  await expect(page.getByRole('combobox', { name: /犬種/ })).toHaveCount(0);
  await page.locator('fieldset.dog-form').getByLabel('名前').fill('アルくん');
  await page.locator('input[type=file]').setInputFiles({ name: 'a.jpg', mimeType: 'image/jpeg', buffer: await makePhoto(page) });
  await expect(page.locator('fieldset.dog-form img.av')).toBeVisible();
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(page.getByRole('link', { name: /アルくん/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /アルくん/ }).locator('img.av')).toBeVisible();

  // 登録をおやすみする(変更画面の一番下の小さいボタン。確認つき)
  await page.getByRole('link', { name: /ニコ/ }).click();
  await page.getByRole('button', { name: 'この子の登録をおやすみする' }).click();
  await expect(page.getByText('ニコの登録をおやすみします。来場の記録はそのまま残り、いつでも戻せます。')).toBeVisible();
  await page.getByRole('button', { name: 'おやすみする', exact: true }).click();
  await expect(page.getByText('おやすみ中のワンちゃん')).toBeVisible();
  await expect(page.getByRole('link', { name: /ニコ/ })).toHaveCount(0);

  // 最後の1頭はおやすみできない
  await page.getByRole('link', { name: /アルくん/ }).click();
  await page.getByRole('button', { name: 'この子の登録をおやすみする' }).click();
  await page.getByRole('button', { name: 'やめる' }).click();
  await expect(page.getByRole('button', { name: 'おやすみする', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'この子の登録をおやすみする' }).click();
  await page.getByRole('button', { name: 'おやすみする', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('最後の1頭は、登録をおやすみできません');

  // おやすみ中のワンちゃんを戻す
  await openLiff(page, user, '/dogs');
  await page.getByRole('button', { name: 'ニコを戻す' }).click();
  await expect(page.getByRole('link', { name: /ニコ/ })).toBeVisible();
  await expect(page.getByText('おやすみ中のワンちゃん')).toHaveCount(0);

  // 画面に「登録解除」「亡くなった」「手放した」の言葉を出さない
  await page.getByRole('link', { name: /ニコ/ }).click();
  await expect(page.getByRole('button', { name: 'この子の登録をおやすみする' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/登録解除|亡くな|手放/);
});
