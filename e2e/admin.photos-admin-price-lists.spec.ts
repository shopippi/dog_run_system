import { expect, test } from '@playwright/test';
import { adminLogin, adminToast } from './helpers';
import { apiAlbumWithPhotos, shot } from './admin.photos-admin-helpers';

// 段階1-A(管理)。PA-5 価格表: 作る・変える(使っているアルバムにすぐ反映)・種類ごとの既定

test('価格表を作り、アルバムに付け、価格表を変えるとアルバムの価格がすぐ変わる', async ({ page }) => {
  test.setTimeout(60_000);
  const tag = Date.now().toString(36).slice(-4);
  const listName = `特別${tag}`;
  await adminLogin(page, 'admin', '/photos/price-lists');
  await page.getByRole('heading', { name: '価格表', exact: true }).waitFor();
  await expect(page.getByRole('listitem', { name: '通常' })).toContainText('1枚 500円');
  await expect(page.getByRole('listitem', { name: '通常' })).toContainText('日付のアルバムの既定');

  await page.getByRole('button', { name: '価格表を作る' }).click();
  const dlg = page.getByRole('dialog', { name: '価格表を作る' });
  await dlg.getByLabel('名前').fill(listName);
  await dlg.getByLabel('1枚の価格(円)').fill('1000');
  await dlg.getByLabel('アルバムまるごとの価格(円)').fill('5,000');
  await shot(page, 'PA-5 価格表を作る(ダイアログ)');
  await dlg.getByRole('button', { name: '作る' }).click();
  await expect(adminToast(page, `価格表「${listName}」を作りました`)).toBeVisible();
  const row = page.getByRole('listitem', { name: listName });
  await expect(row).toContainText('1枚 1,000円 · アルバムまるごと 5,000円 · 使っているアルバム 0冊');

  // アルバムに付ける
  const album = `価格表テスト${tag}`;
  const id = await apiAlbumWithPhotos(page, album, 2);
  await page.goto(`/admin/photos/albums/${id}`);
  await page.getByRole('heading', { name: album }).waitFor();
  await page.getByLabel('価格表').selectOption({ label: `${listName}(1枚 1,000円・まるごと 5,000円)` });
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(adminToast(page, 'アルバムを保存しました')).toBeVisible();
  const cells = page.getByRole('list', { name: '写真' }).getByRole('button');
  await expect(cells.first()).toHaveAccessibleName(/1,000円 · /);

  // 価格表を変える → すぐ反映
  await page.getByRole('link', { name: '価格表' }).click();
  await page.getByRole('button', { name: `「${listName}」を変える` }).click();
  const edit = page.getByRole('dialog', { name: '価格表を変える' });
  await expect(edit).toContainText('1冊のアルバムで使っています');
  await edit.getByLabel('1枚の価格(円)').fill('1500');
  await edit.getByRole('button', { name: '保存する' }).click();
  await expect(adminToast(page, '使っている1冊のアルバムの価格に、すぐ反映しました')).toBeVisible();
  await page.goto(`/admin/photos/albums/${id}`);
  await expect(cells.first()).toHaveAccessibleName(/1,500円 · /);
});

test('種類ごとの既定を変えると、新しいアルバムに付く。50円より安い価格は案内が出る', async ({ page }) => {
  const tag = Date.now().toString(36).slice(-4);
  await adminLogin(page, 'admin', '/photos/price-lists');
  await page.getByRole('heading', { name: '価格表', exact: true }).waitFor();
  await page.getByRole('button', { name: '価格表を作る' }).click();
  const dlg = page.getByRole('dialog', { name: '価格表を作る' });
  await dlg.getByLabel('名前').fill(`安い${tag}`);
  await dlg.getByLabel('1枚の価格(円)').fill('30');
  await dlg.getByRole('button', { name: '作る' }).click();
  await expect(dlg.getByRole('alert')).toContainText('50円以上にしてください');
  await dlg.getByLabel('1枚の価格(円)').fill('300');
  await dlg.getByRole('button', { name: '作る' }).click();
  await expect(adminToast(page, `価格表「安い${tag}」を作りました`)).toBeVisible();

  const defaults = page.getByRole('region', { name: '種類ごとの既定' });
  await defaults.getByLabel('日付のアルバム').selectOption({ label: `安い${tag}(1枚 300円)` });
  await defaults.getByRole('button', { name: '既定を保存する' }).click();
  await expect(adminToast(page, '種類ごとの既定を保存しました')).toBeVisible();
  await expect(page.getByRole('listitem', { name: `安い${tag}` })).toContainText('日付のアルバムの既定');
  // 元に戻す(次のテストのため)
  await defaults.getByLabel('日付のアルバム').selectOption({ label: '通常(1枚 500円)' });
  await defaults.getByRole('button', { name: '既定を保存する' }).click();
  await expect(page.getByRole('listitem', { name: '通常' })).toContainText('日付のアルバムの既定');
});
