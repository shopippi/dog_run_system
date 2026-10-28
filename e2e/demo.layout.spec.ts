import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// デモ画面(apps/demo)そのものの見え方とコントラスト。中の画面(iframe)は、それぞれのテストで確かめている。
// - 横にはみ出さない、押す部品の高さ(指の端末 44px・マウス 40px)、入力欄の文字 16px 以上
// - 文字と背景のコントラスト 4.5:1 以上(ライトとダーク。e2e/contrast.spec.ts の lowContrast と同じ測り方)
// SHOT_DIR を指定すると、画面の写真を保存する。

const WASM = fs.readFileSync(path.resolve(__dirname, '../apps/demo/node_modules/sql.js/dist/sql-wasm.wasm'));

test.beforeEach(async ({ context }) => {
  await context.route(/sql-wasm\.wasm$/, (route) =>
    route.fulfill({ body: WASM, contentType: 'application/wasm', headers: { 'access-control-allow-origin': '*' } }),
  );
});

const VIEWPORTS = [
  { name: '375x667', viewport: { width: 375, height: 667 }, touch: true },
  { name: '768x1024', viewport: { width: 768, height: 1024 }, touch: true },
  { name: '1280x800', viewport: { width: 1280, height: 800 }, touch: false },
] as const;

async function checkLayout(page: Page, touch: boolean): Promise<string[]> {
  return page.evaluate((minHeight) => {
    const out: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) out.push(`横にはみ出し: ${doc.scrollWidth}px > ${doc.clientWidth}px`);
    for (const el of document.querySelectorAll<HTMLElement>('button, a, select')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 20);
      if (r.height < minHeight - 0.5) out.push(`押す部品が低い(${Math.round(r.height)}px): ${name}`);
      if (r.right > doc.clientWidth + 1) out.push(`押す部品がはみ出し: ${name}`);
    }
    for (const el of document.querySelectorAll<HTMLElement>('input:not([type=checkbox]):not([type=radio]), select, textarea')) {
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 16) out.push(`入力欄の文字が小さい(${size}px): ${el.id}`);
    }
    for (const f of document.querySelectorAll('iframe')) {
      const r = f.getBoundingClientRect();
      if (r.right > doc.clientWidth + 1) out.push(`画面の枠がはみ出し: ${f.title}`);
    }
    return out;
  }, touch ? 44 : 40);
}

async function lowContrast(page: Page): Promise<string[]> {
  await page.waitForLoadState('networkidle');
  // 色が切り替わる途中(150ms)で測らないよう、終わる動きは終わるのを待つ
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  return page.evaluate(() => {
    type RGBA = [number, number, number, number];

    const parse = (c: string): RGBA => {
      let m = c.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
      if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
      m = c.match(/^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/);
      if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255, m[4] === undefined ? 1 : Number(m[4])];
      throw new Error(`読めない色: ${c}`);
    };
    const over = (top: RGBA, bottom: RGBA): RGBA => {
      const a = top[3];
      return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
    };
    const hex = (c: RGBA) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    const luminance = (c: RGBA) => {
      const [r, g, b] = c.slice(0, 3).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };

    /** 祖先をさかのぼって、最初の不透明な背景までを重ねた色 */
    const backgroundOf = (el: Element): RGBA => {
      const layers: RGBA[] = [];
      for (let n: Element | null = el; n; n = n.parentElement) {
        const bg = parse(getComputedStyle(n).backgroundColor);
        if (bg[3] > 0) layers.push(bg);
        if (bg[3] >= 1) break;
      }
      let color: RGBA = [255, 255, 255, 1];
      for (const layer of layers.reverse()) color = over(layer, color);
      return color;
    };
    const opacityOf = (el: Element) => {
      let o = 1;
      for (let n: Element | null = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
      return o;
    };

    const out: string[] = [];
    for (const el of document.body.querySelectorAll('*')) {
      const text = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!text) continue;
      if (el.closest('svg, select, option, script, style, .sr-only, button:disabled, [aria-disabled="true"]')) continue;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
      const bg = backgroundOf(el);
      const fgRaw = parse(getComputedStyle(el).color);
      const fg = over([fgRaw[0], fgRaw[1], fgRaw[2], fgRaw[3] * opacityOf(el)], bg);
      const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
      const ratio = (l1 + 0.05) / (l2 + 0.05);
      if (ratio < 4.5) {
        const name = el.tagName.toLowerCase() + [...el.classList].map((c) => `.${c}`).join('');
        out.push(`${name}「${text.slice(0, 24)}」 文字 ${hex(fg)} / 背景 ${hex(bg)} = ${ratio.toFixed(2)}:1`);
      }
    }
    return out;
  });
}

for (const vp of VIEWPORTS) {
  test(`デモ画面の見え方(${vp.name})`, async ({ browser }) => {
    const page = await browser.newPage({ viewport: vp.viewport, hasTouch: vp.touch, isMobile: vp.touch && vp.viewport.width < 500 });
    await page.route(/sql-wasm\.wasm$/, (route) =>
      route.fulfill({ body: WASM, contentType: 'application/wasm', headers: { 'access-control-allow-origin': '*' } }),
    );
    await page.goto('/');
    await page.getByRole('heading', { name: '打ち合わせ用の手順' }).waitFor({ timeout: 30_000 });
    await page.frameLocator('iframe[title="受付・管理画面"]').getByRole('button', { name: 'ログアウト' }).waitFor();
    await page.getByRole('button', { name: /^3\s/ }).click();
    await page.frameLocator('iframe[title="お客さんのスマホ"]').getByRole('button', { name: 'LINEで招待を送る' }).click();
    await expect(page.getByRole('region', { name: 'LINE のトーク' })).toContainText('こむぎママさんから');
    expect(await checkLayout(page, vp.touch)).toEqual([]);
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/デモ画面 ${vp.name}.png`, fullPage: true });

    await page.getByRole('button', { name: '最初からやり直す' }).click();
    await expect(page.getByRole('dialog', { name: '最初からやり直す' })).toBeVisible();
    expect(await checkLayout(page, vp.touch)).toEqual([]);
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/デモ画面 やり直しの確認 ${vp.name}.png` });
    await page.close();
  });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`デモ画面の文字が背景に対して読める(${scheme === 'light' ? 'ライト' : 'ダーク'})`, async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
    await page.route(/sql-wasm\.wasm$/, (route) =>
      route.fulfill({ body: WASM, contentType: 'application/wasm', headers: { 'access-control-allow-origin': '*' } }),
    );
    await page.goto('/');
    await page.getByRole('heading', { name: '打ち合わせ用の手順' }).waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: /^3\s/ }).click();
    await page.frameLocator('iframe[title="お客さんのスマホ"]').getByRole('button', { name: 'LINEで招待を送る' }).click();
    await expect(page.getByRole('region', { name: 'LINE のトーク' })).toContainText('こむぎママさんから');
    await page.getByRole('button', { name: '翌日にする' }).click();
    await expect(page.getByRole('status')).toContainText('になりました');
    expect(await lowContrast(page), 'デモ画面').toEqual([]);
    await page.getByRole('button', { name: '最初からやり直す' }).click();
    expect(await lowContrast(page), 'やり直しの確認').toEqual([]);
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/デモ画面 ${scheme}.png`, fullPage: true });
    await page.close();
  });
}
