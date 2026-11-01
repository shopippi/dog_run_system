import { expect, test } from '@playwright/test';
import { lowContrast } from './households-helpers';
import { adminLogin, newLineUser, openLiff } from './helpers';
import { seedPurchases, shot } from './photos-delivery-helpers';

// 段階1-D の画面のコントラスト(4.5:1。ライトとダーク): PU-7 購入した写真(一覧・選ぶ・開いたところ)、PA-1、PA-7

test.describe.configure({ timeout: 120_000 });

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme === 'light' ? 'ライト' : 'ダーク'}: 購入した写真・ダッシュボード・設定の文字が読める`, async ({ browser, request }) => {
    const liff = await browser.newPage({ viewport: { width: 393, height: 759 }, isMobile: true, hasTouch: true, colorScheme: scheme });
    await liff.goto('/liff/');
    const user = newLineUser('コントラスト');
    await seedPurchases(liff, request, user, [{ name: '11月1日のドッグラン', eventDate: '2026-11-01', photos: 2 }]);
    await openLiff(liff, user, '/photos/purchased');
    await liff.getByRole('heading', { name: '購入した写真', exact: true }).waitFor();
    await liff.waitForLoadState('networkidle');
    expect(await lowContrast(liff), 'PU-7').toEqual([]);
    await liff.getByRole('button', { name: 'まとめてダウンロード' }).click();
    await liff.getByRole('button', { name: '全部選ぶ' }).click();
    expect(await lowContrast(liff), 'PU-7 選ぶ').toEqual([]);
    await liff.getByRole('button', { name: 'やめる', exact: true }).click();
    await liff.getByRole('button', { name: 'IMG_2001.JPGを開く' }).click();
    await liff.getByRole('dialog').waitFor();
    await liff.waitForTimeout(400);
    expect(await lowContrast(liff), 'PU-7 開いたところ').toEqual([]);
    if (scheme === 'dark') await liff.screenshot({ path: shot('liff-PU-7-dark') });
    await liff.close();

    const admin = await browser.newPage({ viewport: { width: 1024, height: 768 }, colorScheme: scheme });
    await adminLogin(admin, 'admin', '/photos');
    await admin.getByRole('region', { name: '新しい注文' }).waitFor();
    await admin.waitForLoadState('networkidle');
    expect(await lowContrast(admin), 'PA-1').toEqual([]);
    if (scheme === 'dark') await admin.screenshot({ path: shot('admin-PA-1-dark'), fullPage: true });
    await admin.goto('/admin/photos/settings');
    await admin.getByRole('region', { name: '販売期間' }).waitFor();
    await admin.waitForLoadState('networkidle');
    expect(await lowContrast(admin), 'PA-7').toEqual([]);
    if (scheme === 'dark') await admin.screenshot({ path: shot('admin-PA-7-dark'), fullPage: true });
    await admin.close();
  });
}
