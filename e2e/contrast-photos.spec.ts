import { expect, test } from '@playwright/test';
import { lowContrast } from './households-helpers';
import { adminLogin, newLineUser, openLiff } from './helpers';

// 写真販売の画面のコントラスト(4.5:1。ライトとダーク)。段階1の各担当は contrast-photos-<担当>.spec.ts を足す。

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme === 'light' ? 'ライト' : 'ダーク'}: 写真販売の画面の文字が背景に対して読める`, async ({ browser }) => {
    const admin = await browser.newPage({ viewport: { width: 1024, height: 768 }, colorScheme: scheme });
    await adminLogin(admin, 'admin', '/photos');
    await admin.getByRole('heading', { name: '写真販売', exact: true }).waitFor();
    await admin.waitForLoadState('networkidle');
    expect(await lowContrast(admin), 'PA-1').toEqual([]);
    await admin.close();
    const liff = await browser.newPage({ viewport: { width: 393, height: 759 }, isMobile: true, hasTouch: true, colorScheme: scheme });
    await openLiff(liff, newLineUser('ゲスト'), '/photos');
    await liff.getByText('写真の販売は準備中です').waitFor();
    await liff.waitForLoadState('networkidle');
    expect(await lowContrast(liff), 'PU-1').toEqual([]);
    await liff.close();
  });
}
