import { expect, test, type Page } from '@playwright/test';
import { lowContrast } from './households-helpers';
import { adminLogin, newLineUser, openLiff } from './helpers';
import { addToCartApi, checkoutApi, disablePhotoSales, enablePhotoSales, payMockApi, seedTwoAlbums } from './photos-checkout-helpers';

// 段階1-C の画面のコントラスト(4.5:1。ライトとダーク): PU-5 カート・まねの支払い・PU-6 購入完了・法定表示・PA-6 注文

test.beforeAll(() => enablePhotoSales());
test.afterAll(() => disablePhotoSales());

async function measure(page: Page, name: string) {
  await page.waitForLoadState('networkidle');
  expect(await lowContrast(page), name).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme === 'light' ? 'ライト' : 'ダーク'}: カート・支払い・購入完了・注文の文字が読める`, async ({ browser, request }) => {
    test.setTimeout(120_000);
    const { a, b } = seedTwoAlbums(`${scheme} `);
    const user = newLineUser(`色 ${scheme}`);
    await addToCartApi(request, user, [
      { kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0]! },
      { kind: 'photo', albumId: b.albumId, photoId: b.photoIds[0]! },
      { kind: 'album', albumId: b.albumId },
    ]);
    const liff = await browser.newPage({ viewport: { width: 393, height: 759 }, isMobile: true, hasTouch: true, colorScheme: scheme });
    await openLiff(liff, user, '/photos/cart');
    await liff.getByText('アルバムまるごとに含まれています').waitFor();
    await measure(liff, 'PU-5 カート');

    await liff.getByRole('button', { name: '購入手続きへ' }).click();
    await liff.getByText('練習用の支払いの画面です。お金は動きません。').waitFor();
    await measure(liff, 'PU-5 まねの支払い');

    await liff.getByRole('button', { name: '支払う(練習)' }).click();
    await liff.getByRole('heading', { name: 'ご購入ありがとうございます' }).waitFor();
    await measure(liff, 'PU-6 購入完了');

    // お支払いを確かめているあいだ
    await addToCartApi(request, user, [{ kind: 'photo', albumId: a.albumId, photoId: a.photoIds[1]! }]);
    const pending = await checkoutApi(request, user);
    await openLiff(liff, user, `/photos/orders/${pending.orderId}`);
    await liff.getByRole('heading', { name: 'お支払いを確かめています' }).waitFor();
    expect(await lowContrast(liff), 'PU-6 確かめています').toEqual([]);

    await openLiff(liff, user, '/photos/legal');
    await liff.getByRole('heading', { name: '特定商取引法に基づく表記・利用規約' }).waitFor();
    await measure(liff, '法定表示');
    await openLiff(liff, newLineUser('空'), '/photos/cart');
    await liff.getByText('カートは空です。').waitFor();
    await measure(liff, 'PU-5 カート(空)');
    await liff.close();
    await payMockApi(request, user, pending.checkoutUrl);

    const admin = await browser.newPage({ viewport: { width: 1024, height: 768 }, colorScheme: scheme });
    await adminLogin(admin, 'admin', '/photos/orders');
    await admin.getByRole('link', { name: new RegExp(`^注文番号 ${pending.orderId} `) }).waitFor();
    await measure(admin, 'PA-6 注文の一覧');
    await admin.getByRole('link', { name: new RegExp(`^注文番号 ${pending.orderId - 1} `) }).click();
    await admin.locator('.po-refund b', { hasText: '返金できます' }).first().waitFor();
    await measure(admin, 'PA-6 注文の内容');
    await admin.getByRole('checkbox').first().check();
    await admin.getByRole('button', { name: /選んだ明細を返金する/ }).click();
    await admin.getByRole('dialog', { name: '返金する' }).waitFor();
    await measure(admin, 'PA-6 返金のダイアログ');
    await admin.close();
  });
}
