import { expect, test, type Browser } from '@playwright/test';
import { cancelOnToday, checkScreen, checkinViaLiff } from './households-helpers';
import { adminLogin, newLineUser, registerViaUi } from './helpers';

// おうちの詳細と記録(M-06、M-07、M-15)の見え方。PC(1280)とタブレット縦(768)で確かめる。
const VIEWPORTS = [
  { name: '1280x800', viewport: { width: 1280, height: 800 }, touch: false },
  { name: '768x1024', viewport: { width: 768, height: 1024 }, touch: true },
] as const;

/** 取り消したチェックインがある状態を作る */
async function seed(browser: Browser) {
  const customer = await browser.newPage();
  const user = newLineUser('パパ');
  await registerViaUi(customer, user, ['ココア', 'キナコ']);
  await checkinViaLiff(customer, user);
  await customer.close();
  const page = await browser.newPage();
  await adminLogin(page, 'admin');
  await cancelOnToday(page, 'ココア', 'お客さんの勘違い');
  await page.close();
}

test.describe('おうちの詳細と記録の見え方', () => {
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

      // M-15 操作ログ と 元に戻すの確認
      await page.getByRole('link', { name: '操作ログ' }).click();
      const row = page.getByRole('list', { name: '操作の一覧' }).getByRole('listitem').filter({ hasText: 'ココア・キナコのおうち' }).first();
      await expect(row).toBeVisible();
      await checkScreen(page, v.name, 'M-15 操作ログ', v.touch);
      await row.getByRole('button', { name: '元に戻す' }).click();
      const dialog = page.getByRole('dialog', { name: '操作を元に戻す' });
      await expect(dialog).toBeVisible();
      await checkScreen(page, v.name, 'M-15 元に戻すの確認', v.touch);
      await dialog.getByRole('button', { name: 'やめる' }).click();
      await expect(dialog).toHaveCount(0);

      await page.close();
    });
  }
});
