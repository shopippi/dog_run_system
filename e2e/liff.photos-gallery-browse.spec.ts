import { expect, test, type Page } from '@playwright/test';
import { authHeaders } from './customer-helpers';
import { checkScreen } from './households-helpers';
import { newLineUser, openLiff, registerViaUi } from './helpers';
import {
  grantPhoto,
  mockCartApi,
  retireAlbums,
  seedGalleryAlbum,
  startPhotoSales,
  stopPhotoSales,
  type SeededAlbum,
} from './liff.photos-gallery-helpers';

// 段階1-B ギャラリー(PU-2 アルバム一覧・PU-3 アルバム詳細・PU-4 写真ビューア)の通しの操作。
// アルバム一覧 → 詳細 → ビューアのスワイプ、複数選択してカートに入れる(1-C の API の前は 501 の「準備中」/ まねのカート)、
// 会員証のメニューの「写真を買う」。見え方(スマホ 393×759 と小さい画面)も確かめる。

const PHONE = { viewport: { width: 393, height: 759 }, isMobile: true, hasTouch: true } as const;
const SMALL = { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true } as const;

let dateAlbum: SeededAlbum;
let eventAlbum: SeededAlbum;
let oldAlbum: SeededAlbum;

test.beforeAll(async ({ browser, request }) => {
  // DB への直接の書き込み(wrangler d1 execute)は1回ごとに時間がかかる
  test.setTimeout(240_000);
  const page = await browser.newPage();
  dateAlbum = await seedGalleryAlbum(page, request, { name: '2026/10/31', kind: 'date', eventDate: '2026-10-31', photos: 30, albumPrice: 3000, firstPriceOverride: 1200 });
  eventAlbum = await seedGalleryAlbum(page, request, { name: 'ハロウィンのわんわん仮装大会', kind: 'event', eventDate: '2026-10-25', photos: 4 });
  oldAlbum = await seedGalleryAlbum(page, request, { name: '2026/09/20', kind: 'date', eventDate: '2026-09-20', photos: 2 });
  await page.close();
  startPhotoSales();
});

test.afterAll(() => {
  stopPhotoSales();
  retireAlbums([dateAlbum, eventAlbum, oldAlbum]);
});

/** スワイプ(指で払う)。pointer のイベントを順に送る。slow はゆっくり動かす(速さで前後へ行かないように) */
async function swipe(page: Page, dx: number, slow = false) {
  const stage = page.locator('.ph-stage');
  const box = (await stage.boundingBox())!;
  const y = box.y + box.height / 2;
  const x0 = box.x + box.width / 2;
  const opts = (x: number) => ({ pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true });
  await stage.dispatchEvent('pointerdown', opts(x0));
  for (let i = 1; i <= 6; i++) {
    if (slow) await page.waitForTimeout(80);
    await stage.dispatchEvent('pointermove', opts(x0 + (dx * i) / 6));
  }
  await stage.dispatchEvent('pointerup', { ...opts(x0 + dx), buttons: 0 });
}

test('PU-2〜PU-4: アルバム一覧 → 詳細 → ビューアのスワイプ。購入済みの印・販売終了日・まるごと購入', async ({ browser }) => {
  const page = await browser.newPage(PHONE);
  const user = newLineUser('ゲスト');
  const userId = user.split(':')[0]!;
  grantPhoto(userId, 'ゲスト', dateAlbum.albumId, dateAlbum.photoIds[1]!);

  // PU-2 アルバム一覧(会員でなくても開ける)
  await openLiff(page, user, '/photos');
  await expect(page.getByRole('heading', { name: '写真', exact: true })).toBeVisible();
  const list = page.getByRole('list', { name: 'アルバム' });
  await expect(list.getByRole('link', { name: /2026\/10\/31/ })).toBeVisible();
  await expect(list.getByRole('link', { name: /ハロウィン/ })).toContainText('イベント');
  await expect(list.getByRole('link', { name: /ハロウィン/ })).toContainText('4枚');
  // カバー写真が読み込まれる(認証つきの API から blob の URL で)
  await expect(list.locator('img.ph-album-cover').first()).toHaveAttribute('src', /^blob:/);
  await checkScreen(page, '393x759', 'PU-2 アルバム一覧', true);

  // イベント / 日付のタブ
  await page.getByRole('radio', { name: 'イベント' }).check({ force: true });
  await expect(list.getByRole('link')).toHaveCount(1);
  await expect(list.getByRole('link', { name: /ハロウィン/ })).toBeVisible();
  await page.getByRole('radio', { name: '日付' }).check({ force: true });
  await expect(list.getByRole('link', { name: /ハロウィン/ })).toHaveCount(0);
  // 年月の絞り込み
  await page.getByLabel('撮った月').selectOption('2026-09');
  await expect(list.getByRole('link')).toHaveCount(1);
  await expect(list.getByRole('link', { name: /2026\/09\/20/ })).toBeVisible();
  await page.getByRole('radio', { name: 'すべて' }).check({ force: true });

  // PU-3 アルバム詳細
  await list.getByRole('link', { name: /2026\/10\/31/ }).click();
  await expect(page.getByRole('heading', { name: '2026/10/31' })).toBeVisible();
  await expect(page.getByText('2099年12月31日まで販売しています')).toBeVisible();
  await expect(page.getByText('アルバムまるごと')).toBeVisible();
  await expect(page.getByRole('button', { name: 'まるごとカートに入れる' })).toBeVisible();
  const grid = page.getByRole('list', { name: '写真' });
  await expect(grid.getByRole('button')).toHaveCount(30);
  await expect(grid.getByRole('button', { name: /写真 1・1,200円/ })).toBeVisible();
  await expect(grid.getByRole('button', { name: '写真 2・500円・購入済み' })).toContainText('購入済み');
  // 遅延読み込み: 最初の1画面分だけ読み、下の写真はまだ読まない
  await expect(grid.locator('img').first()).toHaveAttribute('src', /^blob:/);
  const loadedFirst = await grid.locator('img').count();
  expect(loadedFirst).toBeLessThan(30);
  await grid.getByRole('button', { name: /^写真 30・/ }).scrollIntoViewIfNeeded();
  await expect(grid.locator('img')).toHaveCount(30);
  await page.evaluate(() => window.scrollTo(0, 0));
  await checkScreen(page, '393x759', 'PU-3 アルバム詳細', true);

  // PU-4 ビューア
  await grid.getByRole('button', { name: /写真 1・/ }).click();
  await expect(page.getByRole('heading', { name: /写真 1 \/ 30/ })).toBeVisible();
  await expect(page.getByRole('img', { name: '写真 1(見本の文字入り)' })).toHaveAttribute('src', /^blob:/);
  await expect(page.getByText('1,200円')).toBeVisible();
  await checkScreen(page, '393x759', 'PU-4 写真ビューア', true);
  // 左へスワイプで次の写真(画面は作り直さず URL も変わる)
  await swipe(page, -160);
  await expect(page.getByRole('heading', { name: /写真 2 \/ 30/ })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/photos/albums/${dateAlbum.albumId}/photos/${dateAlbum.photoIds[1]}(\\?|$)`));
  await expect(page.getByText('この写真は購入済みです。')).toBeVisible();
  await expect(page.getByRole('link', { name: '購入した写真を見る' })).toBeVisible();
  // 少しだけゆっくり動かしたときは、元に戻る
  await swipe(page, -30, true);
  await expect(page.getByRole('heading', { name: /写真 2 \/ 30/ })).toBeVisible();
  // 右へスワイプで前の写真。最初の写真ではそれより前へ行かない
  await swipe(page, 160);
  await expect(page.getByRole('heading', { name: /写真 1 \/ 30/ })).toBeVisible();
  await swipe(page, 160);
  await expect(page.getByRole('heading', { name: /写真 1 \/ 30/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '前の写真' })).toBeDisabled();
  // ボタンとキーボードでも動かせる
  await page.getByRole('button', { name: '次の写真' }).click();
  await page.getByRole('button', { name: '次の写真' }).click();
  await expect(page.getByRole('heading', { name: /写真 3 \/ 30/ })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('heading', { name: /写真 2 \/ 30/ })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  // 読み込み直しても同じ写真が開く
  await page.reload();
  await expect(page.getByRole('heading', { name: /写真 3 \/ 30/ })).toBeVisible();
  // 戻るはアルバムへ
  await page.getByRole('link', { name: 'アルバム' }).click();
  await expect(page.getByRole('heading', { name: '2026/10/31' })).toBeVisible();
  await page.close();
});

test('PU-3: カートの API(1-C)がまだのときは、入れようとすると「準備中」と出る', async ({ browser, request }) => {
  const page = await browser.newPage(PHONE);
  const user = newLineUser('ゲスト');
  const real = await request.post('/api/photos/cart/items', {
    headers: authHeaders(user),
    data: { items: [{ kind: 'photo', albumId: eventAlbum.albumId, photoId: eventAlbum.photoIds[0] }] },
  });
  await openLiff(page, user, `/photos/albums/${eventAlbum.albumId}`);
  await page.getByRole('button', { name: '選ぶ' }).click();
  await page.getByRole('button', { name: /写真 2・/ }).click();
  await page.getByRole('button', { name: '選んだ1枚をカートに入れる' }).click();
  if (real.status() === 501) {
    await expect(page.getByRole('alert')).toContainText('カートに入れる機能は準備中です');
    // 選んだものは残る(あとで入れ直せる)
    await expect(page.getByRole('button', { name: '選んだ1枚をカートに入れる' })).toBeVisible();
  } else {
    // 1-C の API ができたあと(統合のあと)は、そのまま入る
    await expect(page.getByRole('status').filter({ hasText: 'カートに入れました' })).toBeVisible();
  }
  await page.close();
});

test('PU-3・PU-4: 複数を選んでまとめてカートに入れる。カートの数と印。ビューアでは1枚ずつ', async ({ browser }) => {
  const page = await browser.newPage(PHONE);
  const cart = await mockCartApi(page);
  const user = newLineUser('ゲスト');
  grantPhoto(user.split(':')[0]!, 'ゲスト', dateAlbum.albumId, dateAlbum.photoIds[1]!);
  await openLiff(page, user, `/photos/albums/${dateAlbum.albumId}`);
  const grid = page.getByRole('list', { name: '写真' });
  await expect(grid.getByRole('button')).toHaveCount(30);

  // 選ぶ状態にする: 写真を押しても開かず、印が付く
  await page.getByRole('button', { name: '選ぶ' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'カートに入れる写真を押してください' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'カートに入れる', exact: true })).toBeDisabled();
  for (const n of [1, 3, 4]) await grid.getByRole('button', { name: new RegExp(`^写真 ${n}・`) }).click();
  await expect(grid.getByRole('button', { name: /^写真 3・/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('3枚を選んでいます')).toBeVisible();
  await expect(page.getByText('3枚 · 2,200円')).toBeVisible();
  // 購入済みの写真は選べない
  await grid.getByRole('button', { name: /^写真 2・/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'この写真は購入済みです' })).toBeVisible();
  await expect(grid.getByRole('button', { name: /^写真 2・/ })).toHaveAttribute('aria-pressed', 'false');
  // 押し直すと外れる
  await grid.getByRole('button', { name: /^写真 4・/ }).click();
  await grid.getByRole('button', { name: /^写真 4・/ }).click();
  await checkScreen(page, '393x759', 'PU-3 アルバム詳細(選んでいる)', true);

  // 読み込み直しても(ビューアを開いて戻っても)、選んだものは残る
  await page.reload();
  await expect(page.getByText('3枚を選んでいます')).toBeVisible();

  await page.getByRole('button', { name: '選んだ3枚をカートに入れる' }).click();
  await expect(page.getByRole('status').filter({ hasText: '3枚をカートに入れました。' })).toBeVisible();
  expect(cart.posts).toEqual([
    {
      items: [1, 3, 4].map((n) => ({ kind: 'photo', albumId: dateAlbum.albumId, photoId: dateAlbum.photoIds[n - 1] })),
    },
  ]);
  // カートの数(ヘッダーの近く)と、グリッドの「カート」の印
  await expect(page.getByRole('link', { name: 'カート(3件)' })).toBeVisible();
  await expect(grid.getByRole('button', { name: /^写真 3・.*カートに入っています/ })).toContainText('カート');
  await expect(page.getByRole('button', { name: /選んだ/ })).toHaveCount(0);

  // もう一度選ぶとき、カートに入っている写真は選べない。すべて選ぶは、選べる写真だけ
  await page.getByRole('button', { name: '選ぶ' }).click();
  await grid.getByRole('button', { name: /^写真 1・/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'もうカートに入っています' })).toBeVisible();
  await page.getByRole('button', { name: 'すべて選ぶ' }).click();
  await expect(page.getByText('26枚を選んでいます')).toBeVisible();
  await page.getByRole('button', { name: 'やめる' }).click();
  await expect(page.getByRole('button', { name: '選ぶ' })).toBeVisible();

  // まるごと購入
  await page.getByRole('button', { name: 'まるごとカートに入れる' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'アルバムまるごとをカートに入れました。' })).toBeVisible();
  expect(cart.posts.at(-1)).toEqual({ items: [{ kind: 'album', albumId: dateAlbum.albumId }] });
  await expect(page.getByRole('link', { name: 'カートに入っています' })).toBeVisible();

  // ビューアは1枚ずつ。カートに入っている写真はその印
  await page.goto(`/liff/photos/albums/${eventAlbum.albumId}/photos/${eventAlbum.photoIds[0]}?mockUser=${encodeURIComponent(user)}`);
  await page.getByRole('button', { name: 'カートに入れる' }).click();
  await expect(page.getByRole('status').filter({ hasText: '1枚をカートに入れました。' })).toBeVisible();
  expect(cart.posts.at(-1)).toEqual({ items: [{ kind: 'photo', albumId: eventAlbum.albumId, photoId: eventAlbum.photoIds[0] }] });
  await expect(page.getByText('この写真は、カートに入っています。')).toBeVisible();
  await expect(page.getByRole('link', { name: 'カートを見る' })).toBeVisible();
  await page.getByRole('button', { name: '次の写真' }).click();
  await expect(page.getByRole('button', { name: 'カートに入れる' })).toBeVisible();
  await page.close();
});

test('会員証のメニューに「写真を買う」が出る(販売中のときだけ)', async ({ browser }) => {
  const page = await browser.newPage(PHONE);
  const user = newLineUser('ママ');
  await registerViaUi(page, user, ['こむぎ']);
  await openLiff(page, user, '/');
  const link = page.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: '写真を買う' });
  await expect(link).toBeVisible({ timeout: 10_000 });
  await link.click();
  await expect(page.getByRole('heading', { name: '写真', exact: true })).toBeVisible();
  // 販売を止めると、次に開いたときに消える
  stopPhotoSales();
  try {
    await openLiff(page, user, '/');
    await page.waitForResponse((r) => r.url().includes('/api/photos/config'));
    await expect(page.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: '写真を買う' })).toHaveCount(0);
  } finally {
    startPhotoSales();
  }
  await page.close();
});

test('見え方: 小さい画面(320×568)でも、はみ出さない・押しやすい', async ({ browser }) => {
  const page = await browser.newPage(SMALL);
  const user = newLineUser('ゲスト');
  await openLiff(page, user, '/photos');
  await expect(page.getByRole('list', { name: 'アルバム' })).toBeVisible();
  await checkScreen(page, '320x568', 'PU-2 アルバム一覧', true);
  await page.getByRole('link', { name: /2026\/10\/31/ }).click();
  await expect(page.getByRole('button', { name: '選ぶ' })).toBeVisible();
  await checkScreen(page, '320x568', 'PU-3 アルバム詳細', true);
  await page.getByRole('button', { name: '選ぶ' }).click();
  await page.getByRole('list', { name: '写真' }).getByRole('button', { name: /^写真 1・/ }).click();
  await checkScreen(page, '320x568', 'PU-3 アルバム詳細(選んでいる)', true);
  await page.getByRole('button', { name: 'やめる' }).click();
  await page.getByRole('list', { name: '写真' }).getByRole('button', { name: /^写真 1・/ }).click();
  await expect(page.getByRole('heading', { name: /写真 1 \// })).toBeVisible();
  await checkScreen(page, '320x568', 'PU-4 写真ビューア', true);
  await page.close();
});
