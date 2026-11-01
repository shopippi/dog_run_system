import { expect, test } from '@playwright/test';
import { adminLogin, adminToast } from './helpers';
import { apiAlbumWithPhotos, shot } from './admin.photos-admin-helpers';

// 段階1-A(管理)。PA-3 アルバム一覧(まとめて公開)・PA-4 アルバム編集(一括で価格を変える・元に戻す・外す)

const tag = () => Date.now().toString(36).slice(-4);

test('アルバム一覧: 下書きを選んでまとめて公開する。トーストから元に戻せる', async ({ page }) => {
  test.setTimeout(60_000);
  await adminLogin(page, 'admin', '/photos/albums');
  const a = `まとめ公開A${tag()}`;
  const b = `まとめ公開B${tag()}`;
  await apiAlbumWithPhotos(page, a, 2);
  await apiAlbumWithPhotos(page, b, 1);
  await page.reload();
  await page.getByRole('heading', { name: 'アルバム', exact: true }).waitFor();
  const rowA = page.getByRole('listitem', { name: a });
  const rowB = page.getByRole('listitem', { name: b });
  await expect(rowA).toContainText('下書き');
  await expect(rowA).toContainText('写真 2枚');
  await expect(rowA).toContainText('売上 0円');
  await rowA.getByRole('checkbox').check();
  await rowB.getByRole('checkbox').check();
  await shot(page, 'PA-3 アルバム一覧(選んだ)');
  await page.getByRole('button', { name: '選んだ2冊を公開する' }).click();
  const toast = adminToast(page, '2冊のアルバムを公開しました');
  await expect(toast).toBeVisible();
  await expect(rowA).toContainText('公開中');
  await expect(rowA).toContainText(/\d{4}\/\d{2}\/\d{2}まで販売/);
  await toast.getByRole('button', { name: '元に戻す' }).click();
  await expect(adminToast(page, '公開を取り消しました')).toBeVisible();
  await expect(rowA).toContainText('下書き');
  // 状態で絞る
  await page.getByRole('tab', { name: '公開中' }).click();
  await expect(rowA).toHaveCount(0);
});

test('アルバム編集: 写真を選んで価格を変える → 元に戻す。外す。公開する', async ({ page }) => {
  test.setTimeout(60_000);
  await adminLogin(page, 'admin', '/photos/albums');
  const name = `一括テスト${tag()}`;
  const id = await apiAlbumWithPhotos(page, name, 4);
  await page.goto(`/admin/photos/albums/${id}`);
  await page.getByRole('heading', { name }).waitFor();
  const grid = page.getByRole('list', { name: '写真' });
  const cells = grid.getByRole('button');
  await expect(cells).toHaveCount(4);
  await expect(cells.nth(0)).toHaveAccessibleName(/IMG_0001\.JPG · 800円 · 下書き/);

  // 1枚目を押し、Shift を押しながら3枚目 → 3枚
  await cells.nth(0).click();
  await cells.nth(2).click({ modifiers: ['Shift'] });
  await expect(page.getByText('3枚を選んでいます')).toBeVisible();
  await expect(cells.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await shot(page, 'PA-4 アルバム編集(3枚を選んだ)');
  await page.getByRole('button', { name: '価格を変える' }).click();
  const dlg = page.getByRole('dialog', { name: '価格を変える' });
  await dlg.getByLabel('1枚の価格(円・税込み)').fill('1200');
  await shot(page, 'PA-4 価格を変える(ダイアログ)');
  await dlg.getByRole('button', { name: 'この価格にする' }).click();
  const toast = adminToast(page, '3枚の価格を1,200円にしました');
  await expect(toast).toBeVisible();
  await expect(cells.nth(0)).toHaveAccessibleName(/1,200円.個別. · 下書き/);
  await expect(cells.nth(3)).toHaveAccessibleName(/800円 · /);
  await toast.getByRole('button', { name: '元に戻す' }).click();
  await expect(adminToast(page, '元に戻しました')).toBeVisible();
  await expect(cells.nth(0)).toHaveAccessibleName(/800円 · /);

  // 4枚目を外す
  await cells.nth(3).click();
  await page.getByRole('button', { name: 'アルバムから外す' }).click();
  await page.getByRole('dialog', { name: 'アルバムから外す' }).getByRole('button', { name: '外す' }).click();
  await expect(adminToast(page, '1枚をアルバムから外しました')).toBeVisible();
  await expect(cells).toHaveCount(3);

  await page.getByRole('button', { name: '公開する', exact: true }).click();
  await expect(adminToast(page, 'アルバムを公開しました')).toBeVisible();
  await expect(cells.nth(0)).toHaveAccessibleName(/公開中/);
});

test('製作者は見るだけ(選ぶ・公開のボタンは出さない)', async ({ page }) => {
  await adminLogin(page, 'admin', '/photos/albums');
  const name = `見るだけ${tag()}`;
  const id = await apiAlbumWithPhotos(page, name, 1);
  await page.getByRole('button', { name: 'ログアウト' }).click();
  await adminLogin(page, 'developer', `/photos/albums/${id}`);
  await page.getByRole('heading', { name }).waitFor();
  await expect(page.getByRole('button', { name: '公開する', exact: true })).toHaveCount(0);
  await expect(page.getByRole('toolbar', { name: '選んだ写真の操作' })).toHaveCount(0);
});
