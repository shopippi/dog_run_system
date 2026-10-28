import { expect, test, type Browser, type Page } from '@playwright/test';
import { adminLogin, makePhoto, newLineUser, openCheckin, registerViaUi } from './helpers';
import { insertMigrationRequest, putMedia, requestMerge } from './merge-helpers';

// 担当B(おうちの統合・確認待ち)の画面の、文字と背景のコントラスト(WCAG の 4.5:1)。
// 確かめ方は e2e/contrast.spec.ts の lowContrast と同じ(コピーして使う)。

const TABLET = { viewport: { width: 1024, height: 768 }, hasTouch: true };

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

/** まとめる2つのおうち */
async function seed(browser: Browser) {
  const customer = await browser.newPage();
  const papa = newLineUser('パパ');
  const mama = newLineUser('ママ');
  const papaNo = await registerViaUi(customer, papa, ['ソラ']);
  const mamaNo = await registerViaUi(customer, mama, ['そらちゃん', 'ミルク']);
  await openCheckin(customer, papa);
  await customer.getByRole('button', { name: 'チェックインする' }).click();
  await customer.getByRole('region', { name: 'チェックイン完了' }).waitFor();
  await customer.close();
  return { papaNo, mamaNo };
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme === 'light' ? 'ライト' : 'ダーク', () => {
    test.use({ colorScheme: scheme });

    test('M-09 確認待ちの文字が背景に対して読める', async ({ browser }) => {
      test.setTimeout(90_000);
      const customer = await browser.newPage();
      const papa = newLineUser('パパ');
      const mama = newLineUser('ママ');
      const papaNo = await registerViaUi(customer, papa, ['ルル']);
      const mamaNo = await registerViaUi(customer, mama, ['るるちゃん']);
      await requestMerge(customer, papa, mama);
      const key = `requests/${papaNo}/card-${Date.now()}.jpg`;
      putMedia(key, await makePhoto(customer, 800, 600));
      insertMigrationRequest(papaNo, { source: 'line_card', claimedPoints: 4 }, key);
      await customer.close();

      const page = await browser.newPage({ ...TABLET, colorScheme: scheme });
      await adminLogin(page, 'admin');
      await page.getByRole('link', { name: /確認待ちが \d+件 あります/ }).waitFor();
      await check(page, 'M-02 今日の来場(確認待ちあり)');
      await page.getByRole('link', { name: /確認待ちが \d+件 あります/ }).click();
      const merge = page.getByRole('listitem', { name: `おうちをまとめる申請 るるちゃんのおうち ${mamaNo}` });
      await merge.waitFor();
      await check(page, 'M-09 確認待ち');
      await page.getByRole('listitem', { name: `旧カードの引き継ぎ ルルのおうち ${papaNo}` }).getByRole('button', { name: '確かめて承認する' }).click();
      const approve = page.getByRole('dialog', { name: '旧カードの引き継ぎを承認する' });
      await approve.getByText(/引き継ぎ後/).waitFor();
      await check(page, 'M-09 旧カードの承認');
      await approve.getByRole('button', { name: '承認する' }).click();
      await expect(approve).toHaveCount(0);

      await merge.getByRole('button', { name: '却下する' }).click();
      const dialog = page.getByRole('dialog', { name: '申請を却下する' });
      await dialog.waitFor();
      await check(page, 'M-09 却下の確認');
      await dialog.getByRole('button', { name: '却下する' }).click();
      await expect(merge).toHaveCount(0);
      await page.getByRole('tab', { name: '処理済み' }).click();
      await page.getByRole('listitem', { name: `おうちをまとめる申請 るるちゃんのおうち ${mamaNo}` }).waitFor();
      await check(page, 'M-09 処理済み');

      // 受付で直接入力(引き継ぎ済みの種類は選べない見た目)
      await page.getByRole('tab', { name: '受付で直接入力' }).click();
      const picker = page.getByRole('group', { name: '引き継ぐおうちを探す' });
      await picker.getByRole('searchbox', { name: '探す言葉' }).fill(papaNo);
      await picker.getByRole('list', { name: '引き継ぐおうちを探すの候補' }).getByRole('button', { name: new RegExp(papaNo) }).click();
      const direct = page.getByRole('region', { name: '受付で直接入力' });
      await expect(direct.getByRole('radio', { name: /LINEのショップカード\(引き継ぎ済み\)/ })).toBeDisabled();
      await direct.getByLabel('旧カードのポイント数').fill('3');
      await direct.getByText(/引き継ぎ後/).waitFor();
      await check(page, 'M-09 受付で直接入力');
      await page.close();
    });

    test('M-08 おうちの統合の文字が背景に対して読める', async ({ browser }) => {
      test.setTimeout(90_000);
      const { papaNo, mamaNo } = await seed(browser);
      const page = await browser.newPage({ ...TABLET, colorScheme: scheme });
      await adminLogin(page, 'admin', '/merge');
      await page.getByRole('link', { name: 'おうちの統合' }).click();
      const picker1 = page.getByRole('group', { name: 'おうち1を探す' });
      await picker1.getByRole('searchbox', { name: '探す言葉' }).fill(papaNo);
      const list1 = picker1.getByRole('list', { name: 'おうち1を探すの候補' });
      await list1.getByRole('button', { name: new RegExp(papaNo) }).waitFor();
      await check(page, 'M-08 探す');
      await list1.getByRole('button', { name: new RegExp(papaNo) }).click();
      const picker2 = page.getByRole('group', { name: 'おうち2を探す' });
      await picker2.getByRole('searchbox', { name: '探す言葉' }).fill(mamaNo);
      await picker2.getByRole('list', { name: 'おうち2を探すの候補' }).getByRole('button', { name: new RegExp(mamaNo) }).click();

      const pairing = page.getByRole('listitem', { name: 'そらちゃんの組み合わせ' });
      await pairing.getByRole('radio', { name: 'ソラ', exact: true }).check();
      // ミルクの組み合わせでは、ソラはもう選べない(押せない見た目)
      await expect(page.getByRole('listitem', { name: 'ミルクの組み合わせ' }).getByRole('radio', { name: 'ソラ', exact: true })).toBeDisabled();
      await page.getByRole('region', { name: '4. まとめた後' }).waitFor();
      await check(page, 'M-08 組み合わせと結果');

      await page.getByRole('button', { name: 'まとめる', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'おうちをまとめる' });
      await dialog.waitFor();
      await check(page, 'M-08 確認');
      await dialog.getByRole('button', { name: 'まとめる' }).click();
      await page.getByRole('status').waitFor();
      await check(page, 'M-08 まとめた後');
      await page.close();
    });
  });
}
