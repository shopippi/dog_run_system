import { expect, test, type Page } from '@playwright/test';
import { cancelVisit, checkinOn } from './customer-helpers';
import { makePhoto, newLineUser, openLiff, registerViaUi } from './helpers';

// お客さん向けの残りの画面(担当E)の見え方。確かめ方は e2e/liff.layout.spec.ts と同じ。
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/15.10.0 LIFF';

const DEVICES = [
  { name: 'iPhone SE', viewport: { width: 375, height: 603 }, dpr: 2 },
  { name: 'iPhone 16', viewport: { width: 393, height: 759 }, dpr: 3 },
] as const;

/**
 * 1つの画面を確かめる。
 * - 横にはみ出していない(横スクロールが出ない)
 * - 押すボタン・リンクの行・選択肢の高さが 44px 以上(指で押しやすい)
 * - 入力欄の文字が 16px 以上(iPhone で入力するときに画面が勝手に拡大されない)
 * - 文字が親の枠からはみ出していない(切れ・重なり)
 * SHOT_DIR を指定すると、画面の写真を保存する。
 */
async function checkScreen(page: Page, device: string, screen: string) {
  await page.waitForLoadState('networkidle');
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) out.push(`横にはみ出し: ${doc.scrollWidth}px > ${doc.clientWidth}px`);
    for (const el of document.querySelectorAll<HTMLElement>(
      'button, a.btn, .menu a, label.up, .segment label, .chips label, .cu-link, .help-rows summary',
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || el.closest('[hidden]')) continue;
      if (r.height < 43.5) out.push(`ボタンが低い(${Math.round(r.height)}px): ${el.textContent?.trim().slice(0, 20)}`);
      if (r.right > doc.clientWidth + 1) out.push(`ボタンがはみ出し: ${el.textContent?.trim().slice(0, 20)}`);
    }
    for (const el of document.querySelectorAll<HTMLElement>('input:not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea')) {
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 16) out.push(`入力欄の文字が小さい(${size}px): ${el.getAttribute('aria-label') ?? el.id}`);
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
  if (process.env.SHOT_DIR) {
    await page.screenshot({ path: `${process.env.SHOT_DIR}/${device}/${screen}.png`, fullPage: true });
  }
}

for (const d of DEVICES) {
  test.describe(d.name, () => {
    test.use({ viewport: d.viewport, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true, userAgent: IOS_UA });

    test('お客さん向けの残りの画面が、LINE の画面の中に収まる', async ({ page, request }) => {
      test.setTimeout(90_000);
      const user = newLineUser('ママ');
      await registerViaUi(page, user, ['アルフォンス', 'ニコ']);

      // L-08 来場履歴(取り消した来場・無料券を使った来場を含む)
      for (let i = 1; i <= 9; i++) await checkinOn(request, user, `2026-09-${String(i).padStart(2, '0')}`);
      await checkinOn(request, user, '2026-09-30');
      await checkinOn(request, user, '2026-10-01', true);
      await cancelVisit(request, await checkinOn(request, user, '2026-10-02'));
      await openLiff(page, user, '/history');
      await page.getByRole('heading', { name: '2026年10月' }).waitFor();
      await checkScreen(page, d.name, 'L-08 来場履歴');

      // L-10 プロフィール
      await openLiff(page, user, '/profile');
      await page.getByRole('heading', { name: 'プロフィール' }).waitFor();
      await page.getByLabel('お住まいの郵便番号').fill('1234567');
      await page.getByRole('button', { name: '保存する' }).click();
      await page.getByRole('status').waitFor();
      await checkScreen(page, d.name, 'L-10 プロフィール');

      // L-13 旧カードの引き継ぎ(入力中と、申請したあと)
      await openLiff(page, user, '/migration');
      await page.getByRole('heading', { name: '旧カードの引き継ぎ' }).waitFor();
      await page.getByRole('radio', { name: 'LINEのショップカード' }).check();
      await page.locator('input[type=file]').setInputFiles({ name: 'card.jpg', mimeType: 'image/jpeg', buffer: await makePhoto(page, 1600, 1200) });
      await page.getByRole('img', { name: '選んだカードの写真' }).waitFor();
      await page.getByLabel('だいたいのポイント数').fill('7');
      await checkScreen(page, d.name, 'L-13 旧カードの引き継ぎ');
      await page.getByRole('button', { name: '申請する' }).click();
      await page.getByRole('status').waitFor();
      await checkScreen(page, d.name, 'L-13 旧カードの引き継ぎ(申請後)');
    });
  });
}
