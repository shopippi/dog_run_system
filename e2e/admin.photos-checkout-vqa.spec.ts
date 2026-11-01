import { expect, test } from '@playwright/test';
import { adminLogin, newLineUser } from './helpers';
import { addToCartApi, checkoutApi, enablePhotoSales, payMockApi, seedAlbum } from './photos-checkout-helpers';
import { VqaLog, type AuditOptions } from './visual-qa-helpers';

// PA-6 注文の見え方の点検(e2e/admin.visual-qa.spec.ts と同じ決まり)。CI は 768 と 390。VQA_FULL=1 で 1280・1024・768・390・360

const ALL = [
  { id: 'admin-1280', viewport: { width: 1280, height: 800 }, touch: false },
  { id: 'admin-1024', viewport: { width: 1024, height: 768 }, touch: true },
  { id: 'admin-768', viewport: { width: 768, height: 1024 }, touch: true },
  { id: 'admin-390', viewport: { width: 390, height: 844 }, touch: true },
  { id: 'admin-360', viewport: { width: 360, height: 740 }, touch: true },
];
const sizes = process.env.VQA_FULL === '1' ? ALL : ALL.filter((v) => ['admin-768', 'admin-390'].includes(v.id));

test.beforeAll(() => enablePhotoSales());

for (const v of sizes) {
  test(`見え方の点検 写真販売の注文 ${v.id}`, async ({ browser, request }) => {
    test.setTimeout(150_000);
    const log = new VqaLog(v.id);
    const opts: AuditOptions = { minTap: 40, ignore: ['.toasts', 'svg'], checkCovered: false, allowClip: ['.who'] };
    const album = seedAlbum({
      name: '第3回 秋のわんわん大運動会 〜みんなで走ろう、グリーンドームの芝生広場〜',
      unitPrice: 12800,
      albumPrice: 128000,
      photos: 2,
      filenames: ['DSC_20261101_093015_Christopherson.JPG', 'とても長い名前の写真ファイル_こむぎとだいず_2026.JPG'],
    });
    const user = newLineUser('アレキサンダー・エリザベス・ミケランジェロ');
    await addToCartApi(request, user, [
      { kind: 'photo', albumId: album.albumId, photoId: album.photoIds[0]! },
      { kind: 'album', albumId: album.albumId },
    ]);
    const co = await checkoutApi(request, user);
    await payMockApi(request, user, co.checkoutUrl);

    const page = await browser.newPage({ viewport: v.viewport, hasTouch: v.touch, isMobile: v.viewport.width < 500 });
    await adminLogin(page, 'admin', '/photos/orders');
    await page.getByRole('link', { name: new RegExp(`^注文番号 ${co.orderId} `) }).waitFor();
    await log.check(page, 'PA-6 注文の一覧', opts);
    await page.goto(`/admin/photos/orders/${co.orderId}`);
    await page.getByRole('heading', { name: `注文 #${co.orderId}` }).waitFor();
    await log.check(page, 'PA-6 注文の内容', opts);
    await page.getByRole('checkbox').first().check();
    await page.getByRole('button', { name: /選んだ明細を返金する/ }).click();
    await page.getByRole('dialog', { name: '返金する' }).waitFor();
    await log.check(page, 'PA-6 返金のダイアログ', opts);
    log.report();
    expect(log.problems).toEqual([]);
    await page.close();
  });
}
