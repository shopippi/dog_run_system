import { expect, test } from '@playwright/test';
import { adminLogin, adminToast } from './helpers';
import { dropFolders, fakeFolder, makeJpeg, shot } from './admin.photos-admin-helpers';

// 段階1-A(管理)。PA-2 一斉アップロード → PA-4 公開(docs/photo-requirements.md PF-2・PF-4)

test('フォルダを2つ落とす → 日付とイベントのアルバムができ、JPEG だけを送る → 公開する。同じフォルダをもう一度落とすと飛ばす', async ({ page }) => {
  test.setTimeout(90_000);
  await adminLogin(page, 'admin', '/photos/upload');
  await page.getByRole('heading', { name: '写真のアップロード', exact: true }).waitFor();
  // 同じサーバーで何度動かしても新しいアルバムになるよう、名前に印を付ける
  const tag = Date.now().toString(36).slice(-4);
  const ev = `秋の運動会${tag}`;
  const day = String(1 + (Date.now() % 28)).padStart(2, '0');
  const event = await fakeFolder(page, ev, 3);
  const date = await fakeFolder(page, `2025-10-${day}`, 2, {});
  const drop = page.getByRole('region', { name: 'フォルダを落とす場所' });

  await dropFolders(drop, [event, date]);
  const dated = page.getByRole('region', { name: '送っている写真' }).getByRole('listitem', { name: `2025/10/${day}` });
  await expect(dated).toContainText('2 / 2枚 · 送り終えました', { timeout: 30_000 });
  const batch = page.getByRole('region', { name: '送っている写真' }).getByRole('listitem', { name: ev });
  await expect(batch).toContainText('3 / 3枚 · 送り終えました', { timeout: 30_000 });
  await expect(batch).toContainText('新しいアルバム');
  await expect(batch).toContainText('送った写真 3枚');
  await expect(batch).toContainText('JPEG・HEIC ではないので飛ばしたファイル 1件');
  await expect(adminToast(page, '写真を送り終えました')).toBeVisible();
  await shot(page, 'PA-2 アップロード(送り終えた)');

  // 公開の前に同じフォルダをもう一度 → 同じ下書きのアルバムに入り、同じ写真は飛ばす(途中で止まったときの続きと同じ)
  await dropFolders(drop, [event]);
  const again = page.getByRole('region', { name: '送っている写真' }).getByRole('listitem', { name: ev }).first();
  await expect(page.getByRole('region', { name: '送っている写真' }).getByRole('listitem', { name: ev })).toHaveCount(2);
  await expect(again).toContainText('3 / 3枚 · 送り終えました', { timeout: 30_000 });
  await expect(again).toContainText('同じ写真があったので飛ばした 3枚');
  await expect(again).not.toContainText('新しいアルバム');

  await again.getByRole('link', { name: `「${ev}」を開いて公開する` }).click();
  await page.getByRole('heading', { name: ev }).waitFor();
  const grid = page.getByRole('list', { name: '写真' });
  await expect(grid.getByRole('button')).toHaveCount(3);
  // ファイル名の順・下書き・イベントの価格表(800円)
  await expect(grid.getByRole('button').first()).toHaveAccessibleName(/IMG_1\.jpg · 800円 · 下書き/);
  // プレビューの画像が届いている(管理画面の写真は Worker から出す)
  const src = await grid.locator('img').first().getAttribute('src');
  const res = await page.request.get(src!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('image/jpeg');

  await page.getByRole('button', { name: '公開する', exact: true }).click();
  await expect(adminToast(page, 'アルバムを公開しました')).toBeVisible();
  await expect(page.getByRole('region', { name: 'アルバムの内容' }).getByText('公開中', { exact: true })).toBeVisible();
  await expect(grid.getByRole('button').first()).toHaveAccessibleName(/公開中/);
  await expect(page.getByLabel('販売終了の日')).not.toHaveValue('');
  await shot(page, 'PA-4 アルバム編集(公開した)');
});

test('いまあるアルバムの上に写真を落とすと、そのアルバムに足す', async ({ page }) => {
  test.setTimeout(60_000);
  await adminLogin(page, 'admin', '/photos/albums');
  await page.getByRole('heading', { name: 'アルバム', exact: true }).waitFor();
  const name = `足すテスト${Date.now().toString(36).slice(-4)}`;
  await page.getByRole('button', { name: 'アルバムを作る' }).click();
  const dlg = page.getByRole('dialog', { name: 'アルバムを作る' });
  await dlg.getByLabel('名前').fill(name);
  await dlg.getByRole('button', { name: '作る' }).click();
  await page.getByRole('heading', { name: name }).waitFor();
  await page.getByRole('link', { name: '写真を足す' }).first().click();
  await page.getByRole('heading', { name: '写真のアップロード', exact: true }).waitFor();

  const jpegs = [await makeJpeg(page, 101), await makeJpeg(page, 102)];
  const row = page.getByRole('listitem', { name: name });
  await row.waitFor();
  const dt = await page.evaluateHandle((list: number[][]) => {
    const d = new DataTransfer();
    list.forEach((bytes, i) => d.items.add(new File([new Uint8Array(bytes)], `DROP_${i + 1}.jpg`, { type: 'image/jpeg' })));
    d.items.add(new File(['x'], 'clip.mov', { type: 'video/quicktime' }));
    return d;
  }, jpegs.map((b) => [...b]));
  await row.dispatchEvent('dragover', { dataTransfer: dt });
  await row.dispatchEvent('drop', { dataTransfer: dt });
  const batch = page.getByRole('region', { name: '送っている写真' }).getByRole('listitem', { name: name });
  await expect(batch).toContainText('2 / 2枚 · 送り終えました', { timeout: 30_000 });
  await expect(batch).toContainText('飛ばしたファイル 1件');
});
