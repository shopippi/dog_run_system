import { expect, test } from '@playwright/test';
import { adminLogin, newLineUser, registerViaUi } from './helpers';
import { earnPoints, exchangeToday, householdIdOf } from './tickets-helpers';

test('M-06 管理者がおうちの詳細から「無料券を使用済みにする」を押し、確認してから使用済みにする。操作ログから元に戻せる', async ({ browser, request }) => {
  test.setTimeout(90_000);
  const customer = await browser.newPage();
  const user = newLineUser('ママ');
  const memberNo = await registerViaUi(customer, user, ['ポンズ']);
  await customer.close();
  await earnPoints(request, user, 10);
  await exchangeToday(request, user);

  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await adminLogin(page, 'admin');
  const id = await householdIdOf(page, memberNo);
  await page.goto(`/admin/households/${id}`);
  const tickets = page.getByRole('list', { name: '無料券' });
  await expect(tickets.getByText('ポイントと交換')).toBeVisible();
  await tickets.getByRole('button', { name: '使用済みにする' }).click();
  const dialog = page.getByRole('dialog', { name: '無料券を使用済みにする' });
  await expect(dialog.getByRole('button', { name: 'やめる' })).toBeFocused();
  await expect(dialog).toContainText('ポンズのおうち');
  await expect(dialog).toContainText('使える無料券は 0枚 になります');
  await dialog.getByRole('button', { name: '使用済みにする' }).click();
  await expect(page.getByText(/無料券を1枚、使用済みにしました。/)).toBeVisible();
  await expect(tickets.getByText('使用済み')).toBeVisible();
  await expect(tickets.getByRole('button', { name: '使用済みにする' })).toHaveCount(0);

  // 操作ログから元に戻す
  await page.getByRole('link', { name: '操作ログ' }).first().click();
  const entry = page.getByRole('listitem', { name: /無料券を使用済みにする/ }).first();
  await entry.getByRole('button', { name: '元に戻す' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '元に戻す' }).click();
  await expect(entry.getByText('元に戻し済み')).toBeVisible();
  await page.goto(`/admin/households/${id}`);
  await expect(page.getByRole('list', { name: '無料券' }).getByRole('button', { name: '使用済みにする' })).toBeVisible();
});
