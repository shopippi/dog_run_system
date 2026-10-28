import { expect, test } from '@playwright/test';
import { checkinViaLiff } from './households-helpers';
import { adminLogin, makePhoto, newLineUser, openLiff, registerViaUi } from './helpers';

test('A-04 管理者が写真(回して)・名前・犬種を変えると、会員証と今日の来場にすぐ反映され、犬種の変更は履歴に残る', async ({ browser }) => {
  const customer = await browser.newPage();
  const user = newLineUser('パパ');
  await registerViaUi(customer, user, ['マメスケ']);
  await checkinViaLiff(customer, user);

  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await adminLogin(page, 'admin');
  await page.getByRole('link', { name: 'おうちを探す' }).click();
  await page.getByRole('searchbox', { name: '探す言葉' }).fill('まめすけ');
  await page.getByRole('link', { name: 'マメスケのおうちの詳細を開く' }).click();
  await page.getByRole('link', { name: 'マメスケの情報を見る・変える' }).click();
  await expect(page.getByRole('heading', { name: 'ワンちゃんの情報の変更' })).toBeVisible();

  // 写真を選んで右に回す(横長 1600×1200 → 縦長)
  await page.locator('input[type=file]').setInputFiles({ name: 'a.jpg', mimeType: 'image/jpeg', buffer: await makePhoto(page, 1600, 1200) });
  await page.getByRole('button', { name: '右に回す' }).click();
  // 写真の縮小と回転は端末の中で行うため、混んでいる端末では少し時間がかかる
  await expect(page.getByRole('img', { name: 'マメスケの写真' })).toBeVisible({ timeout: 15_000 });

  await page.getByLabel('名前').fill('マメタロウ');
  await page.getByRole('combobox', { name: /犬種/ }).selectOption({ label: '柴犬' });
  // 犬種を選ぶとサイズが変わり、理由の入力が要る
  await expect(page.getByRole('radio', { name: '中型' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: '保存する' })).toBeDisabled();
  await page.getByLabel('犬種・サイズを変える理由').fill('登録のときの選びまちがい');
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(page.getByRole('status')).toContainText('保存しました');

  const history = page.getByRole('list', { name: '変更の履歴' });
  await expect(history).toContainText('犬種: プードル → 柴犬');
  await expect(history).toContainText('理由: 登録のときの選びまちがい');
  await expect(history).toContainText('名前: マメスケ → マメタロウ');
  const photo = page.getByRole('img', { name: 'マメタロウの写真' });
  await expect(photo).toBeVisible();
  const size = await photo.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
  expect(size).toEqual([600, 800]);

  // 今日の来場に、新しい名前と写真が出る
  await page.getByRole('link', { name: '今日の来場' }).click();
  const row = page.getByRole('listitem', { name: /マメタロウ/ });
  await expect(row.locator('img.av')).toBeVisible();

  // お客さんの会員証にも出る
  await openLiff(customer, user);
  const card = customer.getByRole('region', { name: '会員証' });
  await expect(card.locator('img.av[alt="マメタロウ"]')).toBeVisible();
});

test('A-04 写真を外し、操作ログから元に戻せる。登録のおやすみは確認してから行う', async ({ browser }) => {
  const customer = await browser.newPage();
  const user = newLineUser('ママ');
  await registerViaUi(customer, user, ['チョビ', 'クッキー']);

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await adminLogin(page, 'admin');
  await page.getByRole('link', { name: 'おうちを探す' }).click();
  await page.getByRole('searchbox', { name: '探す言葉' }).fill('ちょび');
  await page.getByRole('link', { name: 'チョビ・クッキーのおうちの詳細を開く' }).click();
  await page.getByRole('link', { name: 'クッキーの情報を見る・変える' }).click();

  await page.locator('input[type=file]').setInputFiles({ name: 'a.jpg', mimeType: 'image/jpeg', buffer: await makePhoto(page, 900, 900) });
  await expect(page.getByRole('img', { name: 'クッキーの写真' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(page.getByRole('status')).toContainText('保存しました');
  await expect(page.getByRole('button', { name: '保存する' })).toBeDisabled();
  await expect(page.getByRole('img', { name: 'クッキーの写真' })).toBeVisible();
  await page.getByRole('button', { name: '写真を外す' }).click();
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(page.getByRole('status')).toContainText('保存しました');
  await expect(page.getByRole('img', { name: 'クッキー(写真なし)' })).toBeVisible();

  await page.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: '操作ログ' }).click();
  const row = page
    .getByRole('list', { name: '操作の一覧' })
    .getByRole('listitem')
    .filter({ has: page.getByText('ワンちゃんの写真の削除', { exact: true }) })
    .filter({ hasText: 'チョビ・クッキーのおうち' });
  await expect(row).toContainText('クッキー(チョビ・クッキーのおうち)');
  await row.getByRole('button', { name: '元に戻す' }).click();
  await page.getByRole('dialog', { name: '操作を元に戻す' }).getByRole('button', { name: '元に戻す' }).click();
  await expect(row.getByText('元に戻し済み')).toBeVisible();
  await row.getByRole('link', { name: /クッキー/ }).click();
  await page.getByRole('link', { name: 'クッキーの情報を見る・変える' }).click();
  await expect(page.getByRole('img', { name: 'クッキーの写真' })).toBeVisible();

  // 登録をおやすみする(確認つき)
  await page.getByRole('button', { name: '登録をおやすみする' }).click();
  const dialog = page.getByRole('dialog', { name: 'ワンちゃんの登録をおやすみする' });
  await expect(dialog).toContainText('これまでの来場の記録は、そのまま残ります');
  await dialog.getByRole('button', { name: 'おやすみする' }).click();
  await expect(page.getByRole('status')).toContainText('登録をおやすみしました');
  await expect(page.getByRole('button', { name: '登録に戻す' })).toBeVisible();
  await expect(page.getByRole('region', { name: /登録の内容/ }).getByText('おやすみ中', { exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/登録解除|登録を解除|亡くな|手放/);
});
