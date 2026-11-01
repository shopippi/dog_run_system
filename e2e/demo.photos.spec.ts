import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// デモの手順10「写真販売」(docs/demo.md)。お客さん: アルバム → 複数選んでカートへ → まるごと → カート → 練習用の支払い → 購入完了 → 購入した写真。
// 管理画面: 写真販売のダッシュボード・アルバム・注文、アップロード(写真を選ぶと、ブラウザの中の代わりの置き場所へ本当に送る)
const WASM = fs.readFileSync(path.resolve(__dirname, '../apps/demo/node_modules/sql.js/dist/sql-wasm.wasm'));

test.beforeEach(async ({ context }) => {
  await context.route(/sql-wasm\.wasm$/, (route) =>
    route.fulfill({ body: WASM, contentType: 'application/wasm', headers: { 'access-control-allow-origin': '*' } }),
  );
});

const phone = (page: Page) => page.frameLocator('iframe[title="お客さんのスマホ"]');
const adminFrame = (page: Page) => page.frameLocator('iframe[title="受付・管理画面"]');

async function openDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('heading', { name: '打ち合わせ用の手順' }).waitFor({ timeout: 60_000 });
  await adminFrame(page).getByRole('button', { name: 'ログアウト' }).waitFor({ timeout: 60_000 });
}

test('手順10: 写真販売(複数選んでカート → まるごと → 練習用の支払い → 購入した写真、管理画面の注文とアップロード)', async ({ page }) => {
  test.setTimeout(150_000);
  await openDemo(page);
  await page.getByRole('button', { name: /^10\s/ }).click();
  await expect(page.getByTestId('scene-hint')).toContainText('10. 写真販売');
  await expect(page.getByText('グリーンドーム 写真').first()).toBeVisible();
  const p = phone(page);

  // きのうのアルバム: 3枚選んでカートに入れる
  await p.getByRole('button', { name: '選ぶ', exact: true }).click();
  const cells = p.locator('.ph-cell');
  for (const i of [0, 1, 2]) await cells.nth(i).click();
  await p.getByRole('button', { name: '選んだ3枚をカートに入れる' }).click();
  await expect(p.getByText('3枚をカートに入れました').first()).toBeVisible();

  // ハロウィンのアルバムをまるごと
  await p.locator('a.header-back').click();
  await p.getByRole('list', { name: 'アルバム' }).getByRole('link', { name: /ハロウィン仮装の日/ }).click();
  await p.getByRole('button', { name: 'まるごとカートに入れる' }).click();
  await expect(p.locator('a.ph-cart-link').first()).toHaveAccessibleName('カート(4件)');

  // カート(500円 × 3 + 4,000円)→ 練習用の支払い → 購入完了
  await p.locator('a.ph-cart-link').first().click();
  await expect(p.getByRole('heading', { name: 'カート' })).toBeVisible();
  await expect(p.getByText('5,500円')).toBeVisible();
  await page.locator('iframe[title="お客さんのスマホ"]').evaluate((el) => el.scrollIntoView({ block: 'end' }));
  await p.getByRole('button', { name: '購入手続きへ' }).click();
  await expect(p.getByText('練習用の支払いの画面です。お金は動きません。')).toBeVisible();
  await p.getByRole('button', { name: /支払う/ }).click();
  await expect(p.getByRole('heading', { name: 'ご購入ありがとうございます' })).toBeVisible({ timeout: 20_000 });
  await p.getByRole('link', { name: '購入した写真を見る' }).first().click();
  await expect(p.getByRole('heading', { name: '購入した写真' })).toBeVisible();
  // 前に買った3枚(1週間前)と、いま買った写真(きのう3枚・ハロウィン16枚)
  await expect(p.getByRole('region', { name: 'ハロウィン仮装の日' })).toContainText('16枚');

  // 管理画面: 写真販売のダッシュボードと注文(いまの注文を含めて3件)
  const a = adminFrame(page);
  await a.getByRole('heading', { name: '写真販売', exact: true }).waitFor();
  await a.getByRole('navigation', { name: '写真販売の画面' }).getByRole('link', { name: '注文' }).click();
  await expect(a.getByText('5,500円')).toBeVisible();
  await expect(a.getByText('4,000円')).toBeVisible();
  await expect(a.getByText('1,500円')).toBeVisible();

  // アップロード: いまあるアルバムに写真を2枚足す(ブラウザで透かし付きのプレビューを作り、代わりの置き場所へ送る)
  await a.getByRole('navigation', { name: '写真販売の画面' }).getByRole('link', { name: 'アップロード' }).click();
  await a.getByRole('heading', { name: '写真のアップロード', exact: true }).waitFor();
  const jpeg = async (n: number) =>
    Buffer.from(
      (
        await page.evaluate((n) => {
          const c = document.createElement('canvas');
          c.width = 900;
          c.height = 600;
          const g = c.getContext('2d')!;
          g.fillStyle = `hsl(${n * 70} 30% 60%)`;
          g.fillRect(0, 0, 900, 600);
          return c.toDataURL('image/jpeg', 0.9);
        }, n)
      ).split(',')[1]!,
      'base64',
    );
  await a
    .getByLabel(/「ハロウィン仮装の日」に足す写真を選ぶ/)
    .setInputFiles([
      { name: 'NEW_1.jpg', mimeType: 'image/jpeg', buffer: await jpeg(1) },
      { name: 'NEW_2.jpg', mimeType: 'image/jpeg', buffer: await jpeg(2) },
    ]);
  await expect(a.getByRole('region', { name: '送っている写真' })).toContainText('2 / 2枚 · 送り終えました', { timeout: 30_000 });
});
