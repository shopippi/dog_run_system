import { expect, test } from '@playwright/test';
import { checkScreen } from './households-helpers';
import { newLineUser, openLiff } from './helpers';

// 写真販売のお客さんの画面(PU-1 準備中)の見え方。段階1の各担当は liff.photos-<担当>-*.spec.ts を足す。

test('お客さん: 販売が準備中なら、会員でなくても「準備中」が出る', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 393, height: 759 }, isMobile: true, hasTouch: true });
  await openLiff(page, newLineUser('はじめての人'), '/photos');
  await expect(page.getByText('写真の販売は準備中です')).toBeVisible();
  await checkScreen(page, '393x759', 'PU-1 写真販売の準備中', true);
  await page.close();
});

