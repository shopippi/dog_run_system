import { expect, test, type Page } from '@playwright/test';
import { adminLogin } from './helpers';

// 設定まわりの画面(担当C)の見え方。e2e/admin.layout.spec.ts の checkScreen と同じ確かめ方。
// PC(1280×800)とタブレット縦(768×1024)の2つの幅で確かめる。
const VIEWPORTS = [
  { name: '1280x800', viewport: { width: 1280, height: 800 }, touch: false },
  { name: '768x1024', viewport: { width: 768, height: 1024 }, touch: true },
] as const;

/**
 * 1つの画面を確かめる。
 * - 横にはみ出していない(横スクロールが出ない)
 * - 押す部品の高さが、指で操作する端末(hasTouch)では 44px 以上、マウスでは 40px 以上
 * - 入力欄の文字が 16px 以上
 * SHOT_DIR を指定すると、画面の写真を保存する。
 */
async function checkScreen(page: Page, folder: string, screen: string, touch: boolean) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const minHeight = touch ? 44 : 40;
  const problems = await page.evaluate((minHeight) => {
    const out: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) out.push(`横にはみ出し: ${doc.scrollWidth}px > ${doc.clientWidth}px`);
    const pressables = document.querySelectorAll<HTMLElement>(
      'button, a, [role=tab], .chips label, .pick-row, label.check, summary',
    );
    for (const el of pressables) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || el.closest('[hidden]')) continue;
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 20);
      if (r.height < minHeight - 0.5) out.push(`押す部品が低い(${Math.round(r.height)}px): ${name}`);
      const inScroller = el.closest('.nav') !== null && doc.clientWidth < 960;
      if (!inScroller && r.right > doc.clientWidth + 1) out.push(`押す部品がはみ出し: ${name}`);
    }
    for (const el of document.querySelectorAll<HTMLElement>('input:not([type=checkbox]):not([type=radio]), select, textarea')) {
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 16) out.push(`入力欄の文字が小さい(${size}px): ${el.getAttribute('aria-label') ?? el.id}`);
    }
    return out;
  }, minHeight);
  expect(problems, `${folder} / ${screen}`).toEqual([]);
  if (process.env.SHOT_DIR) {
    await page.screenshot({ path: `${process.env.SHOT_DIR}/${folder}/${screen}.png`, fullPage: true });
    // 縦に長い画面の写真を撮ると、Chromium が指で操作する端末のまねを外すことがあるので、設定し直す
    if (touch) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    }
  }
}

test.describe('設定まわりの画面の見え方', () => {
  for (const v of VIEWPORTS) {
    test(`${v.name}: 横にはみ出さず、押しやすい大きさになっている`, async ({ browser }) => {
      test.setTimeout(120_000);
      const page = await browser.newPage({ viewport: v.viewport, hasTouch: v.touch });
      await adminLogin(page, 'admin');

      // M-13 ルールの設定
      await page.getByRole('link', { name: 'ルール' }).click();
      await page.getByRole('region', { name: '受付のQRコード' }).getByRole('img', { name: '受付のQRコード' }).waitFor();
      await checkScreen(page, v.name, 'M-13 ルールの設定', v.touch);
      await page.getByRole('button', { name: '合言葉を作り直す' }).click();
      await page.getByRole('dialog', { name: '受付のQRコードを作り直す' }).waitFor();
      await checkScreen(page, v.name, 'M-13 合言葉を作り直す', v.touch);
      await page.getByRole('button', { name: 'やめる' }).click();

      await page.close();
    });
  }

  test('製作者(見るだけ)のルールの設定', async ({ browser }) => {
    const v = VIEWPORTS[0];
    const page = await browser.newPage({ viewport: v.viewport });
    await adminLogin(page, 'developer', '/settings');
    await page.getByRole('region', { name: '受付のQRコード' }).waitFor();
    await checkScreen(page, v.name, 'M-13 ルールの設定(製作者・見るだけ)', v.touch);
    await page.close();
  });
});
