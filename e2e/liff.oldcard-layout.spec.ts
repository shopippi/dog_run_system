import { expect, test, type Page } from '@playwright/test';
import { newLineUser, openLiff, registerViaUi } from './helpers';
import { liffShot } from './liff-shot';
import { migrateViaApi } from './oldcard-helpers';

// 前のカードの引き継ぎ(16章)の、お客さん向けの見え方。会員証の案内と、来場履歴の「前のカードからの引き継ぎ」。
// 確かめ方は e2e/liff.tickets-layout.spec.ts と同じ(横にはみ出さない・押す部品 44px 以上・文字が枠からはみ出さない)。
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/15.10.0 LIFF';

const DEVICES = [
  { name: 'iPhone SE', viewport: { width: 375, height: 603 }, dpr: 2 },
  { name: 'iPhone 16', viewport: { width: 393, height: 759 }, dpr: 3 },
] as const;

async function checkScreen(page: Page, device: string, screen: string) {
  await page.waitForLoadState('networkidle');
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) out.push(`横にはみ出し: ${doc.scrollWidth}px > ${doc.clientWidth}px`);
    for (const el of document.querySelectorAll<HTMLElement>('button, a.btn, .menu a, .cu-link')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || el.closest('[hidden]')) continue;
      if (r.height < 43.5) out.push(`ボタンが低い(${Math.round(r.height)}px): ${el.textContent?.trim().slice(0, 20)}`);
      if (r.right > doc.clientWidth + 1) out.push(`ボタンがはみ出し: ${el.textContent?.trim().slice(0, 20)}`);
    }
    for (const el of document.querySelectorAll<HTMLElement>('main *')) {
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible' && el.clientWidth > 0) {
        if (['svg', 'img'].includes(el.tagName.toLowerCase())) continue;
        out.push(`文字が枠からはみ出し: ${el.tagName.toLowerCase()}.${[...el.classList].join('.')} 「${el.textContent?.trim().slice(0, 16)}」`);
      }
    }
    return out;
  });
  expect(problems, `${device} / ${screen}`).toEqual([]);
  if (process.env.SHOT_DIR) await liffShot(page, `${process.env.SHOT_DIR}/${device}/${screen}.png`);
}

for (const d of DEVICES) {
  test.describe(d.name, () => {
    test.use({ viewport: d.viewport, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true, userAgent: IOS_UA });

    test('前のカードの案内と、引き継いだ記録が LINE の画面の中に収まる', async ({ page }) => {
      test.setTimeout(90_000);
      const user = newLineUser('パパ');
      const memberNo = await registerViaUi(page, user, ['アレキサンダー', 'エリザベス']);
      await openLiff(page, user);
      await page.getByRole('region', { name: '前のカードのポイントを引き継げます' }).waitFor();
      await checkScreen(page, d.name, 'L-07 会員証(前のカードの案内)');
      await migrateViaApi(memberNo, { source: 'line_card', points: 7, tickets: 1 });
      await migrateViaApi(memberNo, { source: 'paper_card', points: 30, card_points: 42 });
      await openLiff(page, user, '/history');
      await page.getByRole('region', { name: '前のカードからの引き継ぎ' }).waitFor();
      await expect(page.getByRole('region', { name: '前のカードからの引き継ぎ' })).toContainText('前のカードから 7ポイント 引き継ぎ');
      await checkScreen(page, d.name, 'L-08 来場履歴(前のカードからの引き継ぎ)');
    });
  });
}
