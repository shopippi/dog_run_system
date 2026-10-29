import { expect, test, type Page } from '@playwright/test';
import { checkinViaLiff, lowContrast } from './households-helpers';
import { adminLogin, adminToast, newLineUser, registerViaUi } from './helpers';

// 2026-10-29 今風の見直し(docs/design.md 11章)の文字と背景のコントラスト(ライトとダーク)。
// トースト(「元に戻す」つき)・ダイアログ(ぼかした背景の上)・道しるべ・検索欄の「/」の印。
// スケルトンは文字がないので対象外(11.5)。
const DESKTOP = { viewport: { width: 1280, height: 800 } };

async function check(page: Page, screen: string) {
  expect(await lowContrast(page), screen).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme === 'light' ? 'ライト' : 'ダーク', () => {
    test.use({ colorScheme: scheme });

    test('トースト・ダイアログ・道しるべの文字が背景に対して読める', async ({ browser }) => {
      test.setTimeout(90_000);
      const customer = await browser.newPage({ colorScheme: scheme });
      const user = newLineUser('パパ');
      await registerViaUi(customer, user, ['モナカ']);
      await checkinViaLiff(customer, user);
      await customer.close();

      const page = await browser.newPage({ ...DESKTOP, colorScheme: scheme });
      await adminLogin(page, 'admin');
      const row = page.getByRole('listitem', { name: /モナカ/ }).first();

      // ダイアログ(背景をぼかす)
      await row.getByRole('button', { name: '取り消す' }).click();
      const dialog = page.getByRole('dialog', { name: 'チェックインを取り消す' });
      await dialog.waitFor();
      await check(page, 'M-02 取り消しの確認(ダイアログ)');

      // トースト(「元に戻す」つき)。「元に戻す」にフォーカスがある間は消えない
      await dialog.getByRole('button', { name: '取り消す' }).click();
      const toast = adminToast(page, 'モナカのチェックインを取り消しました。');
      await toast.getByRole('button', { name: '元に戻す' }).focus();
      await check(page, 'M-02 取り消しのトースト');
      await expect(toast).toBeVisible();
      await toast.getByRole('button', { name: '元に戻す' }).click();
      await adminToast(page, 'モナカの取り消しを元に戻しました。').waitFor();
      await check(page, 'M-02 元に戻したトースト');

      // 道しるべ(おうちの詳細)
      await page.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: 'おうちを探す' }).click();
      const search = page.getByRole('searchbox', { name: '探す言葉' });
      // 検索欄の「/」の印(フォーカスがないとき)
      await search.blur();
      await page.locator('h1').click();
      await expect(page.locator('.search-kbd')).toBeVisible();
      await check(page, 'M-04 おうちを探す(「/」の印)');
      await search.fill('もなか');
      await page.getByRole('link', { name: 'モナカのおうちの詳細を開く' }).click();
      await page.getByRole('navigation', { name: 'いまいる場所' }).getByText('モナカのおうち').waitFor();
      await check(page, 'M-06 おうちの詳細(道しるべ)');
      await page.close();
    });
  });
}
