import { expect, test, type Page } from '@playwright/test';
import { cancelOnToday, checkinViaLiff, lowContrast } from './households-helpers';
import { adminLogin, newLineUser, registerViaUi } from './helpers';

// おうちの詳細と記録(M-06、M-07、M-15)の文字と背景のコントラスト(ライトとダーク)
const TABLET = { viewport: { width: 1024, height: 768 }, hasTouch: true };

async function check(page: Page, screen: string) {
  expect(await lowContrast(page), screen).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme === 'light' ? 'ライト' : 'ダーク', () => {
    test.use({ colorScheme: scheme });

    test('おうちの詳細と記録の文字が背景に対して読める', async ({ browser }) => {
      test.setTimeout(120_000);
      const customer = await browser.newPage({ colorScheme: scheme });
      const user = newLineUser('パパ');
      await registerViaUi(customer, user, ['ルル']);
      await checkinViaLiff(customer, user);
      await customer.close();

      const page = await browser.newPage({ ...TABLET, colorScheme: scheme });
      await adminLogin(page, 'admin');
      await cancelOnToday(page, 'ルル');

      // M-15 操作ログ(元に戻した行と、戻せる行)
      await page.getByRole('link', { name: '操作ログ' }).click();
      const list = page.getByRole('list', { name: '操作の一覧' });
      await list.getByRole('listitem').filter({ hasText: 'ルルのおうち' }).first().waitFor();
      await check(page, 'M-15 操作ログ');
      await list.getByRole('listitem').filter({ hasText: 'ルルのおうち' }).first().getByRole('button', { name: '元に戻す' }).click();
      const dialog = page.getByRole('dialog', { name: '操作を元に戻す' });
      await dialog.waitFor();
      await check(page, 'M-15 元に戻すの確認');
      await dialog.getByRole('button', { name: '元に戻す' }).click();
      await list.getByText('元に戻し済み').first().waitFor();
      await check(page, 'M-15 操作ログ(元に戻し済み)');
      await page.close();
    });
  });
}
