import { expect, test, type Page } from '@playwright/test';
import { adminLogin } from './helpers';

// 設定まわりの画面(担当C)の、文字と背景のコントラスト(WCAG の 4.5:1)。
// e2e/contrast.spec.ts の lowContrast と同じ確かめ方。

const TABLET = { viewport: { width: 1024, height: 768 }, hasTouch: true };

async function lowContrast(page: Page): Promise<string[]> {
  await page.waitForLoadState('networkidle');
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

async function check(page: Page, screen: string) {
  expect(await lowContrast(page), screen).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme === 'light' ? 'ライト' : 'ダーク', () => {
    test.use({ colorScheme: scheme });

    test('設定まわりの画面の文字が背景に対して読める', async ({ browser }) => {
      test.setTimeout(90_000);
      const page = await browser.newPage({ ...TABLET, colorScheme: scheme });
      await adminLogin(page, 'admin', '/settings');
      await page.getByRole('region', { name: '受付のQRコード' }).getByRole('img').waitFor();
      // 保存していない変更があるときの表示も見る
      await page.getByLabel('リピート率の日数').fill('61');
      await check(page, 'M-13 ルールの設定');

      await page.getByRole('link', { name: '犬種' }).click();
      await page.getByRole('list', { name: '犬種' }).getByRole('listitem', { name: 'その他' }).waitFor();
      await check(page, 'M-12 犬種の選択肢');
      await page.getByRole('button', { name: 'チワワを変える' }).click();
      await page.getByRole('dialog', { name: '犬種を変える' }).waitFor();
      await check(page, 'M-12 犬種を変える');
      await page.getByRole('button', { name: 'やめる' }).click();

      await page.getByRole('link', { name: 'アンケート' }).click();
      await page.getByRole('list', { name: '質問' }).getByRole('listitem', { name: '年代' }).waitFor();
      await check(page, 'M-11 アンケートの設定');
      await page.getByRole('button', { name: '年代を変える' }).click();
      await page.getByRole('dialog', { name: '質問を変える' }).waitFor();
      await check(page, 'M-11 質問を変える');
      await page.getByRole('button', { name: 'やめる' }).click();

      await page.getByRole('link', { name: 'スタッフ' }).click();
      const staffRow = page.getByRole('list', { name: 'スタッフ' }).getByRole('listitem', { name: '受付' }).first();
      await staffRow.waitFor();
      await check(page, 'M-14 スタッフ');
      await staffRow.getByRole('button', { name: '受付さんを停止する' }).click();
      await page.getByRole('dialog', { name: 'アカウントを停止する' }).waitFor();
      await check(page, 'M-14 アカウントを停止する');
      await page.getByRole('button', { name: 'やめる' }).click();
      await page.close();

      const dev = await browser.newPage({ ...TABLET, colorScheme: scheme });
      await adminLogin(dev, 'developer', '/settings');
      await dev.getByRole('region', { name: '受付のQRコード' }).waitFor();
      await check(dev, 'M-13 ルールの設定(製作者)');
      await dev.getByRole('link', { name: '犬種' }).click();
      await dev.getByRole('list', { name: '犬種' }).getByRole('listitem', { name: 'その他' }).waitFor();
      await check(dev, 'M-12 犬種の選択肢(製作者)');
      await dev.close();
    });
  });
}
