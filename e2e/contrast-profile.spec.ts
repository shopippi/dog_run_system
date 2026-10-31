import { expect, test, type Page } from '@playwright/test';
import { adminLogin, answerSurvey, newLineUser, openLiff, registerViaUi } from './helpers';

// 飼い主とワンちゃんの情報・ワンちゃんの登録のおやすみ(担当J)の、文字と背景のコントラスト(WCAG の 4.5:1)。
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

    test('ワンちゃんの登録のおやすみの文字が背景に対して読める', async ({ browser }) => {
      test.setTimeout(90_000);
      const page = await browser.newPage({ ...PHONE, colorScheme: scheme });
      const user = newLineUser('ママ');
      await registerViaUi(page, user, ['アル', 'ニコ']);

      await openLiff(page, user, '/dogs');
      await page.getByRole('link', { name: /ニコ/ }).click();
      await page.getByRole('button', { name: 'この子の登録をおやすみする' }).waitFor();
      await check(page, 'L-09 犬の変更(おやすみ)');
      await page.getByRole('button', { name: 'この子の登録をおやすみする' }).click();
      // 下から出るシート(背景が暗くなった状態)
      const sheet = page.getByRole('dialog', { name: /の登録をおやすみします/ });
      await sheet.waitFor();
      await page.waitForTimeout(400);
      await check(page, 'L-09 犬の変更(おやすみの確認)');
      await sheet.getByRole('button', { name: 'おやすみする', exact: true }).click();
      await page.getByText('おやすみ中のワンちゃん').waitFor();
      // 折りたたみを開いた状態で測る
      await page.getByText('おやすみ中のワンちゃん(1)').click();
      // トーストが出ている状態も測る
      await page.locator('.toast').waitFor();
      await check(page, 'L-09 犬の管理(おやすみ中)');
      await page.close();
    });

    test('飼い主とワンちゃんの情報の文字が背景に対して読める(お客さん向け)', async ({ browser }) => {
      test.setTimeout(90_000);
      const page = await browser.newPage({ ...PHONE, colorScheme: scheme });
      const user = newLineUser('ママ');
      await openLiff(page, user);
      await page.getByLabel('利用規約とプライバシーポリシーに同意します').check();
      await page.getByRole('button', { name: '同意して次へ' }).click();
      const form = page.locator('fieldset.dog-form').first();
      await form.getByLabel('名前').fill('アル');
      await form.getByRole('combobox', { name: /犬種/ }).selectOption({ label: 'プードル' });
      await form.locator('details.pf-more summary').click();
      await form.getByLabel('体重').fill('4.2');
      await form.getByRole('radio', { name: '得意' }).check();
      await check(page, 'L-02 犬の登録(任意の項目)');
      await page.getByRole('button', { name: '次へ' }).click();
      await answerSurvey(page);
      await page.getByRole('checkbox', { name: '平日の昼' }).check();
      await check(page, 'L-03 アンケート(任意の質問)');
      await page.getByRole('button', { name: '登録する' }).click();
      await page.getByText('登録が完了しました').waitFor();
      await openLiff(page, user, '/profile');
      await page.getByRole('heading', { name: 'プロフィール' }).waitFor();
      await check(page, 'L-10 プロフィール(新しい項目)');

      const other = newLineUser('パパ');
      await registerViaUi(page, other, ['ニコ']);
      await openLiff(page, other);
      await page.locator('.pf-nudge').waitFor();
      await check(page, 'L-07 会員証(任意のアンケートのお誘い)');
      await page.close();
    });

    test('飼い主とワンちゃんの情報の文字が背景に対して読める(管理画面)', async ({ browser }) => {
      test.setTimeout(90_000);
      const customer = await browser.newPage();
      // ライトとダークで別のおうちにする(データベースはテスト全体で共有するため)
      const dogName = scheme === 'light' ? 'クズモチ' : 'サクラモチ';
      await registerViaUi(customer, newLineUser('パパ'), [dogName]);
      await customer.close();
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: scheme });
      await adminLogin(page, 'admin');
      await page.getByRole('link', { name: 'おうちを探す' }).click();
      await page.getByRole('searchbox', { name: '探す言葉' }).fill(dogName);
      await page.getByRole('link', { name: `${dogName}のおうちの詳細を開く` }).click();
      await page.getByRole('button', { name: 'おうちの回答を変える' }).click();
      const dialog = page.getByRole('dialog', { name: 'おうちの回答を変える' });
      await dialog.getByRole('checkbox', { name: '平日の夕方' }).check();
      await check(page, 'M-06 おうちの回答を変える');
      await dialog.getByRole('button', { name: 'やめる' }).click();
      await page.getByRole('link', { name: `${dogName}の情報を見る・変える` }).click();
      await page.getByLabel('体重(kg)').fill('200');
      await page.getByText(/体重は0.1から100まで/).waitFor();
      await check(page, 'M-07 ワンちゃんの情報の変更(体重・相性・予防注射)');
      await page.getByRole('link', { name: 'アンケート' }).click();
      await page.getByRole('listitem', { name: '来たい時間帯' }).waitFor();
      await check(page, 'M-11 アンケートの設定(いくつでも選ぶ)');
      await page.close();
    });
  });
}
