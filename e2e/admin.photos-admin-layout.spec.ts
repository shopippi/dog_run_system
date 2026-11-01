import { expect, test, type Page } from '@playwright/test';
import { checkScreen } from './households-helpers';
import { adminLogin } from './helpers';
import { VqaLog, type AuditOptions } from './visual-qa-helpers';
import { apiAlbumWithPhotos, dropFolders, fakeFolder } from './admin.photos-admin-helpers';

// 段階1-A(管理)の画面の見え方: PA-2 アップロード・PA-3 アルバム一覧・PA-4 アルバム編集・PA-5 価格表(とダイアログ)。
// はみ出し・押す部品の高さ(checkScreen)と、重なり・切れ(visual-qa-helpers の auditPage)。PC・タブレット・スマホの幅。
// SHOT_DIR・VQA_SHOTS があれば写真を残す。

const SIZES = [
  { id: 'admin-1280', viewport: { width: 1280, height: 800 }, touch: false },
  { id: 'admin-768', viewport: { width: 768, height: 1024 }, touch: true },
  { id: 'admin-390', viewport: { width: 390, height: 844 }, touch: true },
];

const VQA: AuditOptions = { minTap: 40, ignore: ['.toasts', 'svg'], checkCovered: false };

async function screens(page: Page, size: (typeof SIZES)[number], log: VqaLog, albumId: number, albumName: string) {
  const check = async (name: string) => {
    await checkScreen(page, size.id, name, size.touch);
    await log.check(page, name, VQA);
  };

  await page.goto('/admin/photos/upload');
  await page.getByRole('heading', { name: '写真のアップロード', exact: true }).waitFor();
  await page.getByRole('listitem', { name: albumName }).waitFor();
  await check('PA-2 アップロード');
  const folder = await fakeFolder(page, `見え方の確かめ${size.id}`, 2);
  await dropFolders(page.getByRole('region', { name: 'フォルダを落とす場所' }), [folder]);
  await expect(page.getByRole('region', { name: '送っている写真' })).toContainText('送り終えました', { timeout: 30_000 });
  await check('PA-2 アップロード(送り終えた)');

  await page.goto('/admin/photos/albums');
  await page.getByRole('heading', { name: 'アルバム', exact: true }).waitFor();
  await page.getByRole('listitem', { name: albumName }).waitFor();
  await check('PA-3 アルバム一覧');
  await page.getByRole('button', { name: 'アルバムを作る' }).click();
  await page.getByRole('dialog', { name: 'アルバムを作る' }).getByLabel('価格表').waitFor();
  await check('PA-3 アルバムを作る(ダイアログ)');
  await page.keyboard.press('Escape');

  await page.goto(`/admin/photos/albums/${albumId}`);
  await page.getByRole('heading', { name: albumName }).waitFor();
  await page.getByRole('list', { name: '写真' }).getByRole('button').first().waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.ph-agrid img')].every((i) => (i as HTMLImageElement).complete));
  await check('PA-4 アルバム編集');
  await page.getByRole('list', { name: '写真' }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'ほかのアルバムへ' }).click();
  await page.getByRole('dialog', { name: 'ほかのアルバムへ' }).waitFor();
  await check('PA-4 ほかのアルバムへ(ダイアログ)');
  await page.keyboard.press('Escape');

  await page.goto('/admin/photos/price-lists');
  await page.getByRole('heading', { name: '価格表', exact: true }).waitFor();
  await page.getByRole('listitem', { name: '通常' }).waitFor();
  await check('PA-5 価格表');
  await page.getByRole('button', { name: '「通常」を変える' }).click();
  await page.getByRole('dialog', { name: '価格表を変える' }).waitFor();
  await check('PA-5 価格表を変える(ダイアログ)');
  await page.keyboard.press('Escape');
}

for (const size of SIZES) {
  test(`${size.id}: アップロード・アルバム・価格表の画面がはみ出さず、重ならない`, async ({ browser }) => {
    test.setTimeout(150_000);
    const page = await browser.newPage({ viewport: size.viewport, hasTouch: size.touch, isMobile: size.viewport.width < 500 });
    await adminLogin(page, 'admin', '/photos/albums');
    const albumName = `秋のわんわん運動会と記念撮影${Date.now().toString(36).slice(-3)}`;
    const albumId = await apiAlbumWithPhotos(page, albumName, 6);
    // 価格の違う写真・非公開の写真も並べる
    await page.request.post(`/admin/api/photos/albums/${albumId}/photos/bulk`, {
      headers: { 'x-dr-admin': '1' },
      data: { action: 'set_price', photoIds: [(await (await page.request.get(`/admin/api/photos/albums/${albumId}`)).json()).photos[1].photoId], price: 12000 },
    });
    const log = new VqaLog(size.id);
    await screens(page, size, log, albumId, albumName);
    log.report();
    expect(log.problems).toEqual([]);
    await page.close();
  });
}
