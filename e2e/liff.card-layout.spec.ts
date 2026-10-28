import { expect, test, type Page } from '@playwright/test';
import { makeCardPhoto } from './card-helpers';
import { newLineUser, openLiff, registerViaUi } from './helpers';
import { earnPoints } from './tickets-helpers';

// 担当I: 会員証(L-07)の背景と、背景を変える画面(L-07b)の見え方(C-06、docs/design.md 5章)。
// 確かめ方は e2e/liff.layout.spec.ts と同じ。会員証は 墨(初期値)・砂(明るい単色)・写真(明るい写真と暗い写真)で撮る。
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
    for (const el of document.querySelectorAll<HTMLElement>(
      'button, a.btn, .menu a, label.up, .segment label, .chips label, .cu-link, .mc-change, .cb-swatch',
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || el.closest('[hidden]')) continue;
      if (r.height < 43.5) out.push(`ボタンが低い(${Math.round(r.height)}px): ${el.textContent?.trim().slice(0, 20) || el.getAttribute('aria-label')}`);
      if (r.right > doc.clientWidth + 1) out.push(`ボタンがはみ出し: ${el.textContent?.trim().slice(0, 20)}`);
    }
    for (const el of document.querySelectorAll<HTMLElement>('main *')) {
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible' && el.clientWidth > 0) {
        if (['svg', 'img'].includes(el.tagName.toLowerCase())) continue;
        out.push(`文字が枠からはみ出し: ${el.tagName.toLowerCase()}.${[...el.classList].join('.')} 「${el.textContent?.trim().slice(0, 16)}」`);
      }
    }
    // 会員証: 縦横比 1.58:1 前後。上段・犬・下段が重ならず、カードの中に収まる
    const card = document.querySelector<HTMLElement>('.member-card');
    if (card) {
      const c = card.getBoundingClientRect();
      const ratio = c.width / c.height;
      if (ratio < 1.4 || ratio > 1.6) out.push(`会員証の縦横比が 1.58 から離れている: ${ratio.toFixed(2)}`);
      const box = (sel: string) => card.querySelector(sel)!.getBoundingClientRect();
      const top = box('.mc-top');
      const dogs = box('.mc-dogs');
      const bottom = box('.mc-bottom');
      if (top.bottom > dogs.top + 0.5) out.push('会員証: 呼び名と犬が重なっている');
      if (dogs.bottom > bottom.top + 0.5) out.push('会員証: 犬と会員IDが重なっている');
      for (const [name, r] of [['上段', top], ['下段', bottom]] as const) {
        if (r.left < c.left - 0.5 || r.right > c.right + 0.5 || r.top < c.top - 0.5 || r.bottom > c.bottom + 0.5) {
          out.push(`会員証: ${name}がカードからはみ出している`);
        }
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

    test('会員証の背景(墨・砂・写真)と、背景を変える画面が、LINE の画面の中に収まる', async ({ page, request }) => {
      test.setTimeout(120_000);
      const user = newLineUser('パパ');
      // 呼び名が 20 文字(2行)になるおうち
      await registerViaUi(page, user, ['アレクサンドラ', 'マクシミリアンヌ']);
      await earnPoints(request, user, 3);
      await openLiff(page, user);
      const card = page.getByRole('region', { name: '会員証' });
      await expect(card.getByText('アレクサンドラ・マクシミリアンヌのおうち')).toBeVisible();
      await expect(card).toHaveClass(/mc-preset-ink/);
      await expect(card.getByText('グリーンドーム')).toBeVisible();
      await checkScreen(page, d.name, 'L-07 会員証(墨・長い呼び名)');
      // 呼び名は2行まで
      const nameBox = await card.locator('.mc-name').boundingBox();
      expect(nameBox!.height).toBeLessThanOrEqual(17 * 1.4 * 2 + 1);

      // 背景を変える(カードの右上から)
      await card.getByRole('link', { name: '会員証の背景を変える' }).click();
      await page.getByRole('heading', { name: '会員証の背景' }).waitFor();
      await expect(page.getByRole('radio', { name: '墨' })).toBeChecked();
      await checkScreen(page, d.name, 'L-07b 背景を変える');

      // 砂(明るい単色): 影を重ねず、文字を墨にする
      await page.getByRole('radio', { name: '砂' }).check({ force: true });
      await expect(page.getByRole('status')).toHaveText('保存しました');
      const preview = page.getByRole('region', { name: '会員証' });
      await expect(preview).toHaveClass(/mc-preset-sand/);
      await expect(preview.locator('.mc-name')).toHaveCSS('color', 'rgb(22, 25, 29)');
      await expect(preview.locator('.mc-name')).toHaveCSS('text-shadow', 'none');
      await checkScreen(page, d.name, 'L-07b 背景を変える(砂)');
      await openLiff(page, user);
      await expect(card).toHaveClass(/mc-preset-sand/);
      await checkScreen(page, d.name, 'L-07 会員証(砂)');

      // 写真(明るい写真): 下に向かって濃くなる影と、文字の影を重ねる
      await openLiff(page, user, '/card/background');
      await page.locator('input[type=file]').setInputFiles({ name: 'light.jpg', mimeType: 'image/jpeg', buffer: await makeCardPhoto(page, 'light') });
      await expect(page.getByRole('status')).toHaveText('保存しました');
      await expect(page.getByRole('button', { name: '写真をやめる' })).toBeVisible();
      await expect(preview).toHaveClass(/mc-photo-bg/);
      await checkScreen(page, d.name, 'L-07b 背景を変える(写真)');
      await openLiff(page, user);
      await expect(card).toHaveClass(/mc-photo-bg/);
      await card.locator('img.mc-photo').waitFor();
      // 写真は縮小して送られている(長い辺 1200px 以下)
      const natural = await card.locator('img.mc-photo').evaluate((img: HTMLImageElement) => Math.max(img.naturalWidth, img.naturalHeight));
      expect(natural).toBeLessThanOrEqual(1200);
      await expect(card.locator('.mc-name')).toHaveCSS('color', 'rgb(255, 255, 255)');
      expect(await card.locator('.mc-name').evaluate((el) => getComputedStyle(el).textShadow)).not.toBe('none');
      await checkScreen(page, d.name, 'L-07 会員証(明るい写真)');

      // 暗い写真
      await openLiff(page, user, '/card/background');
      await page.locator('input[type=file]').setInputFiles({ name: 'dark.jpg', mimeType: 'image/jpeg', buffer: await makeCardPhoto(page, 'dark') });
      await expect(page.getByRole('status')).toHaveText('保存しました');
      await openLiff(page, user);
      await card.locator('img.mc-photo').waitFor();
      await checkScreen(page, d.name, 'L-07 会員証(暗い写真)');

      // 写真をやめると墨に戻る
      await page.getByRole('link', { name: '背景を変える', exact: true }).click();
      await page.getByRole('button', { name: '写真をやめる' }).click();
      await expect(page.getByRole('status')).toHaveText('保存しました');
      await expect(page.getByRole('radio', { name: '墨' })).toBeChecked();
      await expect(page.getByRole('button', { name: '写真をやめる' })).toHaveCount(0);
    });
  });
}

test.describe('ダークモード', () => {
  test.use({ viewport: { width: 393, height: 759 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IOS_UA, colorScheme: 'dark' });

  test('会員証の色はダークモードでも変わらない(白の背景でも文字は墨)', async ({ page }) => {
    const user = newLineUser('ママ');
    await registerViaUi(page, user, ['ミルクティー']);
    await openLiff(page, user, '/card/background');
    await page.getByRole('radio', { name: '白' }).check({ force: true });
    await expect(page.getByRole('status')).toHaveText('保存しました');
    const card = page.getByRole('region', { name: '会員証' });
    await expect(card).toHaveCSS('background-color', 'rgb(246, 246, 244)');
    await expect(card.locator('.mc-name')).toHaveCSS('color', 'rgb(22, 25, 29)');
    await checkScreen(page, 'iPhone 16 ダークモード', 'L-07b 背景を変える(白)');
    await page.getByRole('radio', { name: '紺' }).check({ force: true });
    await expect(page.getByRole('status')).toHaveText('保存しました');
    await openLiff(page, user);
    await expect(card).toHaveClass(/mc-preset-navy/);
    await checkScreen(page, 'iPhone 16 ダークモード', 'L-07 会員証(紺)');
  });
});
