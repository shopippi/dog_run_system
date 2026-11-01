import { expect, test } from '@playwright/test';
import { cancelOnToday, checkinViaLiff } from './households-helpers';
import { adminLogin, adminToast, newLineUser, openLiff, registerViaUi } from './helpers';

test('A-15 取り消したチェックインを、操作ログから元に戻せる', async ({ browser }) => {
  const customer = await browser.newPage();
  const user = newLineUser('パパ');
  const memberNo = await registerViaUi(customer, user, ['ゴロー']);
  await checkinViaLiff(customer, user);

  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await adminLogin(page, 'admin');
  await cancelOnToday(page, 'ゴロー', '二重のチェックイン');

  await page.getByRole('link', { name: '操作ログ' }).click();
  const list = page.getByRole('list', { name: '操作の一覧' });
  const row = list.getByRole('listitem').filter({ hasText: 'ゴローのおうち' }).filter({ hasText: 'チェックインの取り消し' });
  await expect(row).toContainText(memberNo);
  await expect(row).toContainText('理由: 二重のチェックイン');
  await expect(row).toContainText('管理者');
  await row.getByRole('button', { name: '元に戻す' }).click();
  const dialog = page.getByRole('dialog', { name: '操作を元に戻す' });
  await expect(dialog).toContainText('チェックインの取り消し');
  await expect(dialog.getByRole('button', { name: 'やめる' })).toBeFocused();
  await dialog.getByRole('button', { name: '元に戻す' }).click();
  await expect(adminToast(page, '「チェックインの取り消し」を元に戻しました。')).toBeVisible();
  await expect(row.getByText('元に戻し済み')).toBeVisible();
  await expect(row.getByRole('button', { name: '元に戻す' })).toHaveCount(0);
  // 元に戻したことも、操作ログに残る
  await expect(list.getByRole('listitem').first()).toContainText('「チェックインの取り消し」を元に戻した');

  // 今日の来場の取り消しが消え、お客さんのポイントも戻る
  await page.getByRole('link', { name: '今日の来場' }).click();
  const visit = page.getByRole('listitem', { name: /ゴロー/ });
  await expect(visit.getByRole('button', { name: '取り消す' })).toBeVisible();
  await expect(visit.getByText(/取り消し済み/)).toHaveCount(0);
  await openLiff(customer, user);
  await expect(customer.getByRole('img', { name: 'ポイント 1 / 10' })).toBeVisible();
});

test('A-15 操作の種類で絞り込める。製作者には「元に戻す」が出ない', async ({ browser }) => {
  const customer = await browser.newPage();
  const user = newLineUser('ママ');
  await registerViaUi(customer, user, ['ミント']);
  await checkinViaLiff(customer, user);
  const staff = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await adminLogin(staff, 'staff');
  await cancelOnToday(staff, 'ミント');
  // 受付スタッフのメニューには操作ログがない
  await expect(staff.getByRole('link', { name: '操作ログ' })).toHaveCount(0);

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await adminLogin(page, 'developer', '/audit');
  await page.getByRole('link', { name: '操作ログ' }).click();
  await page.getByLabel('操作の種類').selectOption({ label: 'チェックインの取り消し' });
  const list = page.getByRole('list', { name: '操作の一覧' });
  await expect(list.getByRole('listitem').filter({ hasText: 'ミントのおうち' })).toBeVisible();
  await expect(list.getByText('会員以外の記録')).toHaveCount(0);
  await expect(list.getByRole('button', { name: '元に戻す' })).toHaveCount(0);
});
