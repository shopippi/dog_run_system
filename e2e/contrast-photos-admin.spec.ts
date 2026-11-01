import { expect, test } from '@playwright/test';
import { lowContrast } from './households-helpers';
import { adminLogin } from './helpers';
import { apiAlbumWithPhotos } from './admin.photos-admin-helpers';

// 段階1-A(管理)の画面のコントラスト(4.5:1。ライトとダーク): PA-2〜PA-5 とダイアログ

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme === 'light' ? 'ライト' : 'ダーク'}: アップロード・アルバム・価格表の文字が背景に対して読める`, async ({ browser }) => {
    test.setTimeout(90_000);
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: scheme });
    await adminLogin(page, 'admin', '/photos/albums');
    const name = `コントラスト${scheme}${Date.now().toString(36).slice(-3)}`;
    const id = await apiAlbumWithPhotos(page, name, 3);

    await page.goto('/admin/photos/upload');
    await page.getByRole('listitem', { name }).waitFor();
    expect(await lowContrast(page), 'PA-2').toEqual([]);

    await page.goto('/admin/photos/albums');
    await page.getByRole('listitem', { name }).waitFor();
    expect(await lowContrast(page), 'PA-3').toEqual([]);

    await page.goto(`/admin/photos/albums/${id}`);
    await page.getByRole('list', { name: '写真' }).getByRole('button').first().click();
    expect(await lowContrast(page), 'PA-4').toEqual([]);
    await page.getByRole('button', { name: '価格を変える' }).click();
    await page.getByRole('dialog', { name: '価格を変える' }).waitFor();
    expect(await lowContrast(page), 'PA-4 価格を変える').toEqual([]);
    await page.keyboard.press('Escape');

    await page.goto('/admin/photos/price-lists');
    await page.getByRole('listitem', { name: '通常' }).waitFor();
    expect(await lowContrast(page), 'PA-5').toEqual([]);
    await page.getByRole('button', { name: '価格表を作る' }).click();
    await page.getByRole('dialog', { name: '価格表を作る' }).waitFor();
    expect(await lowContrast(page), 'PA-5 価格表を作る').toEqual([]);
    await page.close();
  });
}
