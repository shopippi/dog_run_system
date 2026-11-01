import { expect, test, type APIRequestContext } from '@playwright/test';
import { checkScreen } from './households-helpers';
import { adminLogin, adminToast, newLineUser } from './helpers';
import { sql } from './merge-helpers';
import { addToCartApi, checkoutApi, enablePhotoSales, payMockApi, seedTwoAlbums } from './photos-checkout-helpers';

// PA-6 注文(段階1-C): 一覧 → 内容 → 返金(条件の内と外)・ダウンロードの記録。製作者は見るだけ

test.beforeAll(() => enablePhotoSales());

async function paidOrder(request: APIRequestContext, name: string) {
  const { a, b } = seedTwoAlbums(`${name} `);
  const user = newLineUser(name);
  await addToCartApi(request, user, [
    { kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0]! },
    { kind: 'photo', albumId: a.albumId, photoId: a.photoIds[1]! },
    { kind: 'album', albumId: b.albumId },
  ]);
  const co = await checkoutApi(request, user);
  await payMockApi(request, user, co.checkoutUrl);
  return co.orderId;
}

for (const v of [
  { name: '1280x800', viewport: { width: 1280, height: 800 }, touch: false },
  { name: '768x1024', viewport: { width: 768, height: 1024 }, touch: true },
] as const) {
  test(`${v.name}: 注文の一覧 → 内容 → 返金`, async ({ browser, request }) => {
    test.setTimeout(120_000);
    const orderId = await paidOrder(request, `返金${v.name}`);
    const page = await browser.newPage({ viewport: v.viewport, hasTouch: v.touch });
    await adminLogin(page, 'admin', '/photos/orders');
    await page.getByRole('heading', { name: '注文', exact: true }).waitFor();
    const row = page.getByRole('link', { name: new RegExp(`^注文番号 ${orderId} `) });
    await expect(row).toBeVisible();
    await expect(row).toContainText('お支払い済み');
    await expect(row).toContainText('3,000円');
    await checkScreen(page, v.name, 'PA-6 注文の一覧', v.touch);

    await row.click();
    await page.getByRole('heading', { name: `注文 #${orderId}` }).waitFor();
    await expect(page.getByText('練習用の支払い(お金は動いていません)')).toBeVisible();
    await expect(page.locator('.po-refund b', { hasText: '返金できます' })).toHaveCount(3);
    await expect(page.getByText('まだダウンロードされていません。')).toBeVisible();
    await checkScreen(page, v.name, 'PA-6 注文の内容', v.touch);

    // 1点を返金する(条件の内)
    await page.getByRole('checkbox', { name: /IMG_2001を返金に選ぶ/ }).check();
    await page.getByRole('button', { name: '選んだ明細を返金する(1点)' }).click();
    const dialog = page.getByRole('dialog', { name: '返金する' });
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole('button', { name: '500円を返金する' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('返金の理由').fill('間違えて買ったと連絡があった');
    await checkScreen(page, v.name, 'PA-6 返金のダイアログ', v.touch);
    await confirm.click();
    await expect(adminToast(page, '1点を返金しました。')).toBeVisible();
    await expect(page.getByText('返金済み(500円)')).toBeVisible();
    await expect(page.locator('.po-summary')).toContainText('一部を返金');
    await page.close();
  });
}

test('条件の外(ダウンロード済み)は、理由と「条件の外で返金する」の印が要る', async ({ browser, request }) => {
  test.setTimeout(90_000);
  const orderId = await paidOrder(request, '条件の外');
  sql(
    `INSERT INTO download_logs (customer_id, photo_id, kind, user_agent, created_at)
     SELECT o.customer_id, oi.photo_id, 'original', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', strftime('%Y-%m-%dT%H:%M:%S+09:00', 'now', '+9 hours')
       FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.id = ${orderId} AND oi.kind = 'photo' ORDER BY oi.id LIMIT 1`,
  );
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await adminLogin(page, 'admin', `/photos/orders/${orderId}`);
  await page.getByRole('heading', { name: `注文 #${orderId}` }).waitFor();
  await expect(page.getByText('お客さんが、もうダウンロードしています。', { exact: false })).toBeVisible();
  await expect(page.getByRole('table')).toContainText('iPhone');
  await expect(page.getByRole('table')).toContainText('1枚ずつ保存');
  await page.getByRole('checkbox', { name: /IMG_2001を返金に選ぶ/ }).check();
  await page.getByRole('button', { name: /選んだ明細を返金する/ }).click();
  const dialog = page.getByRole('dialog', { name: '返金する' });
  await dialog.getByLabel('返金の理由').fill('写りが悪かった');
  const confirm = dialog.getByRole('button', { name: '500円を返金する' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('条件の外で返金する').check();
  await checkScreen(page, '1280x800', 'PA-6 返金のダイアログ(条件の外)', false);
  await confirm.click();
  await expect(adminToast(page, '1点を返金しました。')).toBeVisible();
  await expect(page.getByText('理由: 写りが悪かった')).toBeVisible();
  await page.close();
});

test('製作者は注文を見られるが、返金の操作は出ない', async ({ browser, request }) => {
  test.setTimeout(90_000);
  const orderId = await paidOrder(request, '製作者');
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await adminLogin(page, 'developer', `/photos/orders/${orderId}`);
  await page.getByRole('heading', { name: `注文 #${orderId}` }).waitFor();
  await expect(page.locator('.po-refund b', { hasText: '返金できます' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /返金する/ })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.close();
});
