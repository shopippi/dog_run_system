import { expect, test, type Page } from '@playwright/test';
import { newLineUser, openLiff, registerViaUi } from './helpers';
import { checkinToday, earnPoints, slideToUse } from './tickets-helpers';
import { liffShot } from './liff-shot';

// 担当G: 無料券の交換と使用(C-06)の、お客さん向けの画面の見え方。確かめ方は e2e/liff.layout.spec.ts と同じ。
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/15.10.0 LIFF';

const DEVICES = [
  { name: 'iPhone SE', viewport: { width: 375, height: 603 }, dpr: 2 },
  { name: 'iPhone 16', viewport: { width: 393, height: 759 }, dpr: 3 },
] as const;

/**
 * 1つの画面を確かめる(e2e/liff.customer-layout.spec.ts と同じ)。
 * 横にはみ出さない・押す部品の高さ 44px 以上・入力欄の文字 16px 以上・文字が枠からはみ出さない。SHOT_DIR があれば写真を保存する。
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
    await liffShot(page, `${process.env.SHOT_DIR}/${device}/${screen}.png`);
  }
}

for (const d of DEVICES) {
  test.describe(d.name, () => {
    test.use({ viewport: d.viewport, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true, userAgent: IOS_UA });

    test('無料券の交換と使用の画面が、LINE の画面の中に収まる', async ({ page, request }) => {
      test.setTimeout(120_000);
      const user = newLineUser('ママ');
      // 長い呼び名でも崩れないか
      await registerViaUi(page, user, ['アルフォンス', 'ニコラス']);
      await earnPoints(request, user, 21);
      await checkinToday(request, user);

      // 会員証(交換できるとき)と、交換の確認
      await openLiff(page, user);
      await page.getByRole('button', { name: '無料券と交換する(10ポイント)' }).waitFor();
      await checkScreen(page, d.name, 'L-07 会員証(交換できるとき)');
      await page.getByRole('button', { name: '無料券と交換する(10ポイント)' }).click();
      await page.getByRole('dialog', { name: '無料券と交換します' }).waitFor();
      await checkScreen(page, d.name, 'L-07 会員証(交換の確認)');
      const sheet = page.getByRole('dialog', { name: '無料券と交換します' });
      await sheet.getByRole('button', { name: '交換する', exact: true }).click();
      await expect(page.getByRole('status')).toHaveText('無料券と交換しました。');
      await expect(sheet).toHaveCount(0);
      await page.getByRole('button', { name: '無料券と交換する(10ポイント)' }).click();
      await sheet.getByRole('button', { name: '交換する', exact: true }).click();
      await expect(page.getByText('未使用 2枚')).toBeVisible();
      await checkScreen(page, d.name, 'L-07 会員証(無料券あり)');

      // 右へスライドして使う → 「使用できました」の画面
      const rows = page.getByRole('list', { name: '未使用の無料券' }).getByRole('listitem');
      await slideToUse(page, rows.first());
      await page.getByRole('region', { name: '無料券を使用できました' }).waitFor();
      await checkScreen(page, d.name, 'L-07 使用できました');

      // 会員証(今日使った券があるとき)と、来場履歴の無料券の記録
      await page.getByRole('link', { name: '会員証にもどる' }).click();
      await page.getByRole('link', { name: '今日使った無料券の画面を見る' }).waitFor();
      await checkScreen(page, d.name, 'L-07 会員証(今日使った券があるとき)');
      await openLiff(page, user, '/history');
      await page.getByRole('region', { name: '無料券の記録' }).waitFor();
      await checkScreen(page, d.name, 'L-08 来場履歴(無料券の記録)');
    });
  });
}
