import { expect, test } from '@playwright/test';
import { lowContrast } from './households-helpers';
import { newLineUser, openLiff } from './helpers';
import { grantPhoto, retireAlbums, seedGalleryAlbum, startPhotoSales, stopPhotoSales, type SeededAlbum } from './liff.photos-gallery-helpers';

// 段階1-B ギャラリー(PU-2〜PU-4)の文字と背景のコントラスト(4.5:1。ライトとダーク)。
// 購入済み・カートの印(写真の上の灰色の印)と、選んでいる状態の帯も確かめる。

let album: SeededAlbum;

test.beforeAll(async ({ browser, request }) => {
  test.setTimeout(240_000);
  const page = await browser.newPage();
  album = await seedGalleryAlbum(page, request, { name: 'コントラストの確かめ', kind: 'event', eventDate: '2026-10-18', photos: 6, albumPrice: 2400 });
  await page.close();
  startPhotoSales();
});
test.afterAll(() => {
  stopPhotoSales();
  retireAlbums([album]);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme === 'light' ? 'ライト' : 'ダーク'}: ギャラリーの文字が背景に対して読める`, async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 393, height: 759 }, isMobile: true, hasTouch: true, colorScheme: scheme });
    const user = newLineUser('ゲスト');
    grantPhoto(user.split(':')[0]!, 'ゲスト', album.albumId, album.photoIds[0]!);
    await openLiff(page, user, '/photos');
    await expect(page.getByRole('list', { name: 'アルバム' })).toBeVisible();
    expect(await lowContrast(page), 'PU-2').toEqual([]);
    await openLiff(page, user, `/photos/albums/${album.albumId}`);
    await expect(page.getByRole('button', { name: /購入済み/ })).toContainText('購入済み');
    expect(await lowContrast(page), 'PU-3').toEqual([]);
    await page.getByRole('button', { name: '選ぶ' }).click();
    await page.getByRole('list', { name: '写真' }).getByRole('button', { name: /^写真 2・/ }).click();
    await expect(page.getByText('1枚を選んでいます')).toBeVisible();
    expect(await lowContrast(page), 'PU-3 選んでいる').toEqual([]);
    await openLiff(page, user, `/photos/albums/${album.albumId}/photos/${album.photoIds[0]}`);
    await expect(page.getByText('この写真は購入済みです。')).toBeVisible();
    expect(await lowContrast(page), 'PU-4 購入済み').toEqual([]);
    await page.getByRole('button', { name: '次の写真' }).click();
    await expect(page.getByRole('button', { name: 'カートに入れる' })).toBeVisible();
    expect(await lowContrast(page), 'PU-4').toEqual([]);
    await page.close();
  });
}
