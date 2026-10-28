import { expect, test, type Browser, type Page } from '@playwright/test';
import { checkScreen } from './households-helpers';
import { adminLogin, newLineUser, registerViaUi } from './helpers';

// 飼い主とワンちゃんの情報(担当J)の管理画面の見え方。PC(1280)とタブレット縦(768)で確かめる。
// 確かめ方は e2e/admin.layout.spec.ts の checkScreen と同じ(e2e/households-helpers.ts)。
const VIEWPORTS = [
  { name: '1280x800', viewport: { width: 1280, height: 800 }, touch: false },
  { name: '768x1024', viewport: { width: 768, height: 1024 }, touch: true },
] as const;

async function seed(browser: Browser) {
  const customer = await browser.newPage();
  await registerViaUi(customer, newLineUser('パパ'), ['オモチ', 'シラタマ']);
  await customer.close();
}

async function openHousehold(page: Page) {
  await page.getByRole('link', { name: 'おうちを探す' }).click();
  await page.getByRole('searchbox', { name: '探す言葉' }).fill('おもち');
  await page.getByRole('link', { name: 'オモチ・シラタマのおうちの詳細を開く' }).click();
  await page.getByRole('region', { name: 'アンケート' }).waitFor();
}

test.describe('飼い主とワンちゃんの情報の見え方', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    await seed(browser);
  });

  for (const v of VIEWPORTS) {
    test(`${v.name}: 横にはみ出さず、押しやすい大きさになっている`, async ({ browser }) => {
      test.setTimeout(120_000);
      const page = await browser.newPage({ viewport: v.viewport, hasTouch: v.touch });
      await adminLogin(page, 'admin');

      // M-06 おうちの詳細(アンケートの「おうちの回答を変える」)と、そのダイアログ
      await openHousehold(page);
      await page.getByRole('region', { name: 'アンケート' }).scrollIntoViewIfNeeded();
      await checkScreen(page, v.name, 'M-06 おうちの詳細(アンケート)', v.touch);
      await page.getByRole('button', { name: 'おうちの回答を変える' }).click();
      const dialog = page.getByRole('dialog', { name: 'おうちの回答を変える' });
      await dialog.getByRole('checkbox', { name: '土日の午前' }).check();
      await dialog.getByRole('checkbox', { name: '健康・ケアの相談' }).check();
      await checkScreen(page, v.name, 'M-06 おうちの回答を変える', v.touch);
      await dialog.getByRole('button', { name: 'やめる' }).click();
      await expect(dialog).toHaveCount(0);

      // M-07 ワンちゃんの情報の変更(体重・相性・予防注射)
      await page.getByRole('link', { name: 'シラタマの情報を見る・変える' }).click();
      await page.getByLabel('体重(kg)').fill('12.3');
      await page.getByRole('radiogroup', { name: 'ほかの犬との相性' }).getByRole('radio', { name: 'ふつう' }).click();
      await checkScreen(page, v.name, 'M-07 ワンちゃんの情報の変更(体重・相性・予防注射)', v.touch);
      // 4つの選択肢(相性)が、列の幅からはみ出して隣の入力欄に重ならない
      const overflow = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.dg-fields .segment')].map((g) => {
          const field = g.closest('.field')!.getBoundingClientRect();
          const clipped = [...g.querySelectorAll<HTMLElement>('button')].some((b) => b.scrollWidth > b.clientWidth + 1);
          return g.getBoundingClientRect().right - field.right > 1 || clipped;
        }),
      );
      expect(overflow.every((x) => !x)).toBe(true);
      await page.getByLabel('体重(kg)').fill('123');
      await expect(page.getByText(/体重は0.1から100まで/)).toBeVisible();
      await checkScreen(page, v.name, 'M-07 体重が読めないとき', v.touch);

      // M-11 アンケートの設定(答え方に「いくつでも選ぶ」)
      await page.getByRole('link', { name: 'アンケート' }).click();
      await page.getByRole('radiogroup', { name: '答え方' }).first().getByRole('radio', { name: 'いくつでも選ぶ' }).click();
      await page.getByRole('listitem', { name: '来たい時間帯' }).waitFor();
      await checkScreen(page, v.name, 'M-11 アンケートの設定(いくつでも選ぶ)', v.touch);
      await page.getByRole('button', { name: 'お知らせをLINEで受け取りますかを変える' }).click();
      await page.getByRole('dialog', { name: '質問を変える' }).waitFor();
      await checkScreen(page, v.name, 'M-11 はい・いいえの質問を変える', v.touch);
      await page.close();
    });
  }
});
