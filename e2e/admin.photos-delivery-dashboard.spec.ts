import { expect, test } from '@playwright/test';
import { checkScreen } from './households-helpers';
import { adminLogin, adminToast, newLineUser } from './helpers';
import { sql } from './merge-helpers';
import { resetPhotoSales, seedPurchases, shot } from './photos-delivery-helpers';
import { VqaLog } from './visual-qa-helpers';

// PA-1 写真販売のダッシュボードと PA-7 写真販売の設定(段階1-D)。数・販売終了が近いアルバム・新しい注文、設定の保存と見え方。

test.describe.configure({ timeout: 120_000 });
test.afterAll(() => resetPhotoSales());

test('PA-1: 今月の売上・販売終了が近いアルバム・新しい注文が出る', async ({ browser, request }) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('/liff/');
  const user = newLineUser('ダッシュボードのパパ');
  await seedPurchases(page, request, user, [
    { name: 'もうすぐ終わるアルバム', eventDate: '2026-05-01', photos: 2, saleEndsAt: new Date(Date.now() + 3 * 86400_000) },
    // 同じデータベースでほかのテストが作った注文より新しくする(新しい注文は8件まで出る)
  ], { paidAt: new Date() });
  await adminLogin(page, 'admin', '/photos');
  await page.getByRole('heading', { name: '写真販売', exact: true }).waitFor();
  const summary = page.getByRole('region', { name: /の集計$/ });
  await expect(summary).toContainText('売れた写真');
  await expect(page.getByRole('region', { name: '販売終了が近いアルバム' })).toContainText('もうすぐ終わるアルバム');
  await expect(page.getByRole('link', { name: '販売期間を延ばす' }).first()).toHaveAttribute('href', /\/admin\/photos\/albums\/\d+$/);
  await expect(page.getByRole('region', { name: '新しい注文' })).toContainText('ダッシュボードのパパ');
  await checkScreen(page, '1280x800', 'PA-1 写真販売のダッシュボード', false);
  await page.screenshot({ path: shot('admin-PA-1-dashboard'), fullPage: true });

  const tablet = await browser.newPage({ viewport: { width: 768, height: 1024 }, hasTouch: true });
  await adminLogin(tablet, 'admin', '/photos');
  await tablet.getByRole('region', { name: '新しい注文' }).waitFor();
  await checkScreen(tablet, '768x1024', 'PA-1 写真販売のダッシュボード', true);
  await tablet.screenshot({ path: shot('admin-PA-1-dashboard-768'), fullPage: true });
  const log = new VqaLog('admin-768');
  await log.check(tablet, 'PA-1', { minTap: 44 });
  expect(log.problems).toEqual([]);
  await tablet.close();
  await page.close();
});

test('PA-7: 透かしの文字・販売期間・ダウンロードの上限を保存できる。製作者は変えられない', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await adminLogin(page, 'admin', '/photos/settings');
  await page.getByRole('heading', { name: '写真販売の設定', exact: true }).waitFor();
  const wm = page.getByRole('region', { name: '施設の名前と透かしの文字' });
  await wm.getByLabel('透かしの文字').fill('GREEN DOME SAMPLE');
  await expect(wm.getByLabel('透かしの見本')).toContainText('GREEN DOME SAMPLE');
  await wm.getByRole('button', { name: '保存する' }).click();
  await expect(adminToast(page, '保存しました')).toBeVisible();

  const period = page.getByRole('region', { name: '販売期間' });
  await period.getByLabel('販売期間').fill('8');
  await period.getByRole('button', { name: '保存する' }).click();
  await expect(adminToast(page, '保存しました')).toBeVisible();

  const dl = page.getByRole('region', { name: 'ダウンロードと返金' });
  await dl.getByLabel('回数').fill('0');
  await dl.getByRole('button', { name: '保存する' }).click();
  await expect(dl.getByRole('alert')).toBeVisible();
  await dl.getByLabel('回数').fill('10');
  await expect(dl.getByRole('button', { name: '保存する' })).toBeDisabled();

  const saved = sql("SELECT key, value FROM settings WHERE key IN ('photo_watermark_text', 'photo_sale_months') ORDER BY key");
  expect(saved).toEqual([
    { key: 'photo_sale_months', value: '8' },
    { key: 'photo_watermark_text', value: '"GREEN DOME SAMPLE"' },
  ]);
  // 「販売する」はテストの環境(代わりの置き場所・まねの支払い)では選べる
  await expect(page.getByRole('checkbox', { name: '写真を販売する' })).toBeEnabled();
  await checkScreen(page, '1280x800', 'PA-7 写真販売の設定', false);
  await page.screenshot({ path: shot('admin-PA-7-settings'), fullPage: true });

  // 元に戻す(ほかのテストに影響させない)
  await wm.getByLabel('透かしの文字').fill('');
  await wm.getByRole('button', { name: '保存する' }).click();
  await expect(adminToast(page, '保存しました').first()).toBeVisible();
  await period.getByLabel('販売期間').fill('6');
  await period.getByRole('button', { name: '保存する' }).click();
  await page.close();

  const tablet = await browser.newPage({ viewport: { width: 768, height: 1024 }, hasTouch: true });
  await adminLogin(tablet, 'admin', '/photos/settings');
  await tablet.getByRole('region', { name: '特定商取引法に基づく表記・利用規約' }).waitFor();
  await checkScreen(tablet, '768x1024', 'PA-7 写真販売の設定', true);
  await tablet.close();

  const dev = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await adminLogin(dev, 'developer', '/photos/settings');
  await dev.getByRole('region', { name: '販売期間' }).waitFor();
  await expect(dev.getByRole('checkbox', { name: '写真を販売する' })).toBeDisabled();
  await expect(dev.getByRole('button', { name: '保存する' })).toHaveCount(0);
  await dev.screenshot({ path: shot('admin-PA-7-settings-developer'), fullPage: true });
  await dev.close();
});
