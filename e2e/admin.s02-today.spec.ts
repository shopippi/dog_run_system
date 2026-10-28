import { expect, test } from '@playwright/test';
import { adminLogin, newLineUser, openCheckin, registerViaUi } from './helpers';

test('S-02 今日の来場に、時刻・犬の名前・おうちの呼び名が出て、30秒ごとに新しい来場が増える', async ({ browser }) => {
  const customer = await browser.newPage();
  const user = newLineUser('パパ');
  const memberNo = await registerViaUi(customer, user, ['マロン']);
  await openCheckin(customer, user);
  await customer.getByRole('button', { name: 'チェックインする' }).click();
  await customer.getByRole('region', { name: 'チェックイン完了' }).waitFor();

  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.clock.install();
  await adminLogin(page, 'staff');
  const list = page.getByRole('list', { name: '今日の来場' });
  await expect(list.getByText('マロン', { exact: true })).toBeVisible();
  await expect(list.getByText(memberNo)).toBeVisible();

  // 別のお客さんがチェックインすると、30秒以内に一覧に出る
  const user2 = newLineUser('ママ');
  await registerViaUi(customer, user2, ['チョコ']);
  await openCheckin(customer, user2);
  await customer.getByRole('button', { name: 'チェックインする' }).click();
  await customer.getByRole('region', { name: 'チェックイン完了' }).waitFor();
  await expect(list.getByText('チョコ', { exact: true })).toHaveCount(0);
  await page.clock.fastForward(30_000);
  await expect(list.getByText('チョコ', { exact: true })).toBeVisible();
});
