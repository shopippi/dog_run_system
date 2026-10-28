import { expect, test } from '@playwright/test';
import { adminLogin, newLineUser, openCheckin, openLiff, registerViaUi } from './helpers';

test('S-03 受付で今日のチェックインを取り消すと、お客さんのポイントが元に戻る', async ({ browser }) => {
  const customer = await browser.newPage();
  const user = newLineUser('パパ');
  await registerViaUi(customer, user, ['ポチ']);
  await openCheckin(customer, user);
  await customer.getByRole('button', { name: 'チェックインする' }).click();
  await customer.getByRole('region', { name: 'チェックイン完了' }).waitFor();

  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await adminLogin(page, 'staff');
  const row = page.getByRole('listitem', { name: /ポチ/ });
  await row.getByRole('button', { name: '取り消す' }).click();
  const confirm = page.getByRole('dialog', { name: 'チェックインを取り消す' });
  await expect(confirm).toContainText('付けたポイントを戻します');
  await confirm.getByRole('radio', { name: '二重のチェックイン' }).check();
  await confirm.getByRole('button', { name: '取り消す' }).click();
  await expect(row.getByText('取り消し済み(二重のチェックイン)')).toBeVisible();
  await expect(row.getByRole('button', { name: '取り消す' })).toHaveCount(0);

  await openLiff(customer, user);
  await expect(customer.getByRole('img', { name: 'ポイント 0 / 10' })).toBeVisible();
});

test('S-03 製作者のアカウントには取り消しのボタンが出ない', async ({ browser }) => {
  const customer = await browser.newPage();
  const user = newLineUser('ママ');
  await registerViaUi(customer, user, ['ベル']);
  await openCheckin(customer, user);
  await customer.getByRole('button', { name: 'チェックインする' }).click();
  await customer.getByRole('region', { name: 'チェックイン完了' }).waitFor();

  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await adminLogin(page, 'developer');
  const row = page.getByRole('listitem', { name: /ベル/ });
  await expect(row).toBeVisible();
  await expect(row.getByRole('button', { name: '取り消す' })).toHaveCount(0);
});
