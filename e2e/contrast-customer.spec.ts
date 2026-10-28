import { expect, test, type Page } from '@playwright/test';
import { cancelVisit, checkinOn, joinFamily } from './customer-helpers';
import { makePhoto, newLineUser, openLiff, registerViaUi } from './helpers';

// お客さん向けの残りの画面(担当E)の、文字と背景のコントラスト(WCAG の 4.5:1)。
// lowContrast は e2e/contrast.spec.ts と同じもの。

const PHONE = { viewport: { width: 393, height: 759 }, isMobile: true, hasTouch: true };

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

async function check(page: Page, screen: string) {
  expect(await lowContrast(page), screen).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme === 'light' ? 'ライト' : 'ダーク', () => {
    test.use({ colorScheme: scheme });

    test('お客さん向けの残りの画面の文字が背景に対して読める', async ({ browser, request }) => {
      test.setTimeout(90_000);
      const page = await browser.newPage({ ...PHONE, colorScheme: scheme });
      const user = newLineUser('ママ');
      await registerViaUi(page, user, ['アル']);

      // L-08 来場履歴(取り消した来場・無料券を使った来場を含む)
      for (let i = 1; i <= 9; i++) await checkinOn(request, user, `2026-09-${String(i).padStart(2, '0')}`);
      await checkinOn(request, user, '2026-09-30');
      await checkinOn(request, user, '2026-10-01', true);
      await cancelVisit(request, await checkinOn(request, user, '2026-10-02'));
      await openLiff(page, user, '/history');
      await page.getByRole('heading', { name: '2026年10月' }).waitFor();
      await check(page, 'L-08 来場履歴');

      // L-10 プロフィール
      await openLiff(page, user, '/profile');
      await page.getByRole('heading', { name: 'プロフィール' }).waitFor();
      await page.getByLabel('お住まいの郵便番号').fill('1234567');
      await page.getByRole('button', { name: '保存する' }).click();
      await page.getByRole('status').waitFor();
      await check(page, 'L-10 プロフィール');

      // L-11 家族(招待と、いまの家族・抜ける確認)
      await joinFamily(request, user, newLineUser('パパ'));
      await openLiff(page, user, '/family');
      await page.getByRole('region', { name: 'いまの家族' }).getByRole('listitem').nth(1).waitFor();
      await page.getByRole('button', { name: 'このおうちから抜ける' }).click();
      await page.getByRole('button', { name: '抜ける', exact: true }).waitFor();
      await check(page, 'L-11 家族の一覧');

      // 会員証(メニューの行と「使い方」のリンクが加わった)と、使い方・よくある質問
      await openLiff(page, user);
      await page.getByRole('region', { name: '会員証' }).waitFor();
      await check(page, 'L-07 会員証(メニュー)');
      await page.getByRole('link', { name: '使い方・よくある質問' }).click();
      await page.getByText('無料券はどうやって使いますか?').click();
      await check(page, '使い方・よくある質問');

      // L-13 旧カードの引き継ぎ(入力中・申請後の状態の一覧)
      await openLiff(page, user, '/migration');
      await page.getByRole('heading', { name: '旧カードの引き継ぎ' }).waitFor();
      await page.getByRole('radio', { name: 'LINEのショップカード' }).check();
      await page.getByRole('button', { name: '申請する' }).click();
      await page.getByRole('alert').waitFor();
      await check(page, 'L-13 旧カードの引き継ぎ(足りないとき)');
      await page.locator('input[type=file]').setInputFiles({ name: 'card.jpg', mimeType: 'image/jpeg', buffer: await makePhoto(page, 1600, 1200) });
      await page.getByRole('img', { name: '選んだカードの写真' }).waitFor();
      await page.getByRole('button', { name: '申請する' }).click();
      await page.getByRole('status').waitFor();
      await check(page, 'L-13 旧カードの引き継ぎ(申請後)');
      await page.close();
    });
  });
}
