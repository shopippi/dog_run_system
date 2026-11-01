import { expect, test } from '@playwright/test';
import { checkScreen } from './households-helpers';
import { newLineUser, openLiff } from './helpers';
import { addToCartApi, checkoutApi, disablePhotoSales, enablePhotoSales, payMockApi, seedAlbum, seedTwoAlbums } from './photos-checkout-helpers';

// PU-5 カート → まねの支払い → PU-6 購入完了(段階1-C)。写真を選んでカートに入れる画面は 1-B の担当なので、入れるところは API で行う

const PHONE = { viewport: { width: 393, height: 759 }, isMobile: true, hasTouch: true } as const;

test.beforeAll(() => enablePhotoSales());
test.afterAll(() => disablePhotoSales());

test('複数の写真とまるごとをカートに入れる → まねの支払い → 購入完了', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { a, b } = seedTwoAlbums();
  const user = newLineUser('かいママ');
  const add = await addToCartApi(request, user, [
    { kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0]! },
    { kind: 'photo', albumId: a.albumId, photoId: a.photoIds[1]! },
    { kind: 'photo', albumId: a.albumId, photoId: a.photoIds[2]! },
    { kind: 'photo', albumId: b.albumId, photoId: b.photoIds[0]! },
    { kind: 'album', albumId: b.albumId },
    { kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0]! },
  ]);
  expect(add.added).toBe(5);
  // もう一度入れても、同じ写真は1つだけ
  const again = await addToCartApi(request, user, [{ kind: 'photo', albumId: a.albumId, photoId: a.photoIds[1]! }]);
  expect(again.skipped.map((s) => s.reason)).toEqual(['already_in_cart']);

  const page = await browser.newPage(PHONE);
  await openLiff(page, user, '/photos/cart');
  await page.getByRole('heading', { name: 'カート' }).waitFor();
  const list = page.getByRole('list', { name: 'カートの写真' });
  await expect(list.getByRole('listitem')).toHaveCount(5);
  // まるごとに含まれる1枚は、印を付けて請求しない
  await expect(list.getByText('アルバムまるごとに含まれています')).toBeVisible();
  await expect(page.locator('.co-total')).toContainText('4点');
  await expect(page.locator('.co-total')).toContainText('3,500円');
  await checkScreen(page, '393x759', 'PU-5 カート', true);

  // 1行ずつ外せる
  await page.getByRole('button', { name: 'IMG_2003をカートから外す' }).click();
  await expect(page.getByText('カートから外しました。')).toBeVisible();
  await expect(list.getByRole('listitem')).toHaveCount(4);
  await expect(page.locator('.co-total')).toContainText('3,000円');

  // 購入手続き → まねの支払いの画面
  await page.getByRole('button', { name: '購入手続きへ' }).click();
  await page.getByRole('heading', { name: 'お支払い' }).waitFor();
  await expect(page.getByText('練習用の支払いの画面です。お金は動きません。')).toBeVisible();
  await expect(page.getByRole('list', { name: 'お支払いの明細' }).getByRole('listitem')).toHaveCount(3);
  await expect(page.locator('.co-total')).toContainText('3,000円');
  await checkScreen(page, '393x759', 'PU-5 まねの支払い', true);

  await page.getByRole('button', { name: '支払う(練習)' }).click();
  await page.getByRole('heading', { name: 'ご購入ありがとうございます' }).waitFor();
  await expect(page.getByRole('list', { name: '注文の明細' }).getByRole('listitem')).toHaveCount(3);
  await expect(page.getByRole('link', { name: '購入した写真を見る' })).toBeVisible();
  await checkScreen(page, '393x759', 'PU-6 購入完了', true);

  // カートは空になる
  await openLiff(page, user, '/photos/cart');
  await expect(page.getByText('カートは空です。')).toBeVisible();
  await checkScreen(page, '393x759', 'PU-5 カート(空)', true);
  await page.close();
});

test('購入完了の画面は、お支払いが確定するまで「確かめています」で待ち、確定したら切り替わる', async ({ browser, request }) => {
  test.setTimeout(90_000);
  const a = seedAlbum({ name: '待つ アルバム', unitPrice: 500, photos: 1 });
  const user = newLineUser('待つ人');
  await addToCartApi(request, user, [{ kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0]! }]);
  const co = await checkoutApi(request, user);
  const page = await browser.newPage(PHONE);
  // Stripe から戻ってきた(success_url を開いた)ところ。開いただけでは確定しない
  await openLiff(page, user, `/photos/orders/${co.orderId}`);
  await page.getByRole('heading', { name: 'お支払いを確かめています' }).waitFor();
  await expect(page.locator('main').getByRole('status')).toContainText('自動で切り替わります');
  await checkScreen(page, '393x759', 'PU-6 購入完了(確かめています)', true);
  await page.waitForTimeout(1500);
  await expect(page.getByRole('heading', { name: 'お支払いを確かめています' })).toBeVisible();
  // Webhook(まねの支払い)が届いたら、読み直して切り替わる
  await payMockApi(request, user, co.checkoutUrl);
  await page.getByRole('heading', { name: 'ご購入ありがとうございます' }).waitFor({ timeout: 15_000 });
  await page.close();
});

test('まねの支払いで「やめる」とカートに戻り、カートはそのまま', async ({ browser, request }) => {
  test.setTimeout(90_000);
  const a = seedAlbum({ name: 'やめる アルバム', unitPrice: 500, photos: 1 });
  const user = newLineUser('やめる人');
  await addToCartApi(request, user, [{ kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0]! }]);
  const page = await browser.newPage(PHONE);
  await openLiff(page, user, '/photos/cart');
  await page.getByRole('button', { name: '購入手続きへ' }).click();
  await page.getByRole('heading', { name: 'お支払い' }).waitFor();
  await page.getByRole('button', { name: 'やめてカートに戻る' }).click();
  await page.getByRole('heading', { name: 'カート' }).waitFor();
  await expect(page.getByRole('list', { name: 'カートの写真' }).getByRole('listitem')).toHaveCount(1);
  await page.close();
});

test('特定商取引法に基づく表記・利用規約(返金の条件)', async ({ browser }) => {
  const page = await browser.newPage(PHONE);
  await openLiff(page, newLineUser('読む人'), '/photos/legal');
  await page.getByRole('heading', { name: '特定商取引法に基づく表記・利用規約' }).waitFor();
  await expect(page.getByText('購入から7日以内で、まだ一度もダウンロードしていない写真に限り')).toBeVisible();
  await checkScreen(page, '393x759', 'PU 法定表示', true);
  await page.close();
});
