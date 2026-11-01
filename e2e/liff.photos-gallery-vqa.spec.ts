import { expect, test, type Page } from '@playwright/test';
import { newLineUser } from './helpers';
import { liffShot } from './liff-shot';
import { grantPhoto, retireAlbums, seedGalleryAlbum, startPhotoSales, stopPhotoSales, type SeededAlbum } from './liff.photos-gallery-helpers';
import { newDevicePage, vqaDeviceList, VqaLog, type AuditOptions } from './visual-qa-helpers';

// 段階1-B ギャラリー(PU-2〜PU-4)の見え方の点検(重なり・切れ・はみ出し・押しにくさ・下の帯に隠れる・写真のつぶれ)。
// e2e/liff.visual-qa.spec.ts と同じ端末の組み合わせ: ふだんは iPhone SE と「幅 320・文字 150%・ダーク」、VQA_FULL=1 で全部。
// 長いアルバムの名前・まるごと購入・購入済みの印・選んでいる状態(下の帯)を見る。VQA_SHOTS=ディレクトリ で写真を保存する。

const LONG_NAME = 'ハロウィンのわんわん仮装大会とおやつの交換会(午後の部・小型犬)';
const AUDIT: AuditOptions = { ignore: ['.toast-region'] };

let albums: SeededAlbum[] = [];

test.beforeAll(async ({ browser, request }) => {
  test.setTimeout(240_000);
  const page = await browser.newPage();
  albums = [
    await seedGalleryAlbum(page, request, { name: LONG_NAME, kind: 'event', eventDate: '2026-10-25', photos: 13, albumPrice: 12800, unitPrice: 1000 }),
    await seedGalleryAlbum(page, request, { name: '2026/10/12', kind: 'date', eventDate: '2026-10-12', photos: 3 }),
  ];
  await page.close();
  startPhotoSales();
});
test.afterAll(() => {
  stopPhotoSales();
  retireAlbums(albums);
});

async function open(page: Page, user: string, path: string) {
  await page.goto(`/liff${path}?mockUser=${encodeURIComponent(user)}`);
}

for (const d of vqaDeviceList(['se', 'narrow-text150-dark'])) {
  test(`見え方の点検: ギャラリー(${d.label})`, async ({ browser }) => {
    test.setTimeout(90_000);
    const page = await newDevicePage(browser, d);
    const log = new VqaLog(d.id);
    const check = (name: string) => log.check(page, name, { ...AUDIT, shoot: (p) => liffShot(page, p) });
    const user = newLineUser('ゲスト');
    const [a] = albums;
    grantPhoto(user.split(':')[0]!, 'ゲスト', a!.albumId, a!.photoIds[1]!);

    await open(page, user, '/photos');
    await expect(page.getByRole('list', { name: 'アルバム' })).toBeVisible();
    await check('PU-2 アルバム一覧');
    await open(page, user, `/photos/albums/${a!.albumId}`);
    await expect(page.getByRole('button', { name: 'まるごとカートに入れる' })).toBeVisible();
    await check('PU-3 アルバム詳細');
    await page.getByRole('button', { name: '選ぶ' }).click();
    for (const n of [1, 3]) await page.getByRole('list', { name: '写真' }).getByRole('button', { name: new RegExp(`^写真 ${n}・`) }).click();
    await expect(page.getByText('2枚を選んでいます')).toBeVisible();
    await check('PU-3 アルバム詳細(選んでいる)');
    await open(page, user, `/photos/albums/${a!.albumId}/photos/${a!.photoIds[0]}`);
    await expect(page.getByRole('button', { name: 'カートに入れる' })).toBeVisible();
    await check('PU-4 写真ビューア');
    await page.getByRole('button', { name: '次の写真' }).click();
    await expect(page.getByText('この写真は購入済みです。')).toBeVisible();
    await check('PU-4 写真ビューア(購入済み)');
    log.report();
    expect(log.problems).toEqual([]);
    await page.context().close();
  });
}
