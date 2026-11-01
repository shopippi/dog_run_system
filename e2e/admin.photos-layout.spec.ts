import { expect, test } from '@playwright/test';
import { checkScreen } from './households-helpers';
import { adminLogin } from './helpers';

// 写真販売(docs/photo-requirements.md)の管理画面の見え方。段階0では空の画面と準備中の理由だけ。
// 段階1の各担当は admin.photos-<担当>-*.spec.ts を足す(このファイルは統合の担当のもの)。

const ADMIN_PAGES = [
  ['/photos', 'PA-1 写真販売のダッシュボード', '写真販売'],
  ['/photos/upload', 'PA-2 アップロード', '写真のアップロード'],
  ['/photos/albums', 'PA-3 アルバム一覧', 'アルバム'],
  ['/photos/price-lists', 'PA-5 価格表', '価格表'],
  ['/photos/orders', 'PA-6 注文', '注文'],
  ['/photos/settings', 'PA-7 写真販売の設定', '写真販売の設定'],
] as const;

for (const v of [
  { name: '1280x800', viewport: { width: 1280, height: 800 }, touch: false },
  { name: '768x1024', viewport: { width: 768, height: 1024 }, touch: true },
] as const) {
  test(`${v.name}: 写真販売の管理画面がはみ出さず、準備中の理由が出る`, async ({ browser }) => {
    const page = await browser.newPage({ viewport: v.viewport, hasTouch: v.touch });
    await adminLogin(page, 'admin', '/photos');
    for (const [path, screen, heading] of ADMIN_PAGES) {
      await page.goto(`/admin${path}`);
      await page.getByRole('heading', { name: heading, exact: true }).waitFor();
      await expect(page.getByRole('navigation', { name: '写真販売の画面' })).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: '写真の販売は止めています' })).toBeVisible();
      await checkScreen(page, v.name, screen, v.touch);
    }
    await page.close();
  });
}

test('受付スタッフのメニューには、写真販売を出さない', async ({ page }) => {
  await adminLogin(page, 'staff');
  await page.getByRole('navigation', { name: 'メニュー' }).waitFor();
  await expect(page.getByRole('link', { name: '写真販売' })).toHaveCount(0);
});

