import { expect, test } from '@playwright/test';
import { adminLogin, newLineUser, registerViaUi } from './helpers';
import { requestMerge } from './merge-helpers';

test('A-08 まとめる申請を確認待ちで見て、統合の画面に進んでまとめると承認になる', async ({ browser }) => {
  test.setTimeout(90_000);
  const customer = await browser.newPage();
  const papa = newLineUser('パパ');
  const mama = newLineUser('ママ');
  const papaNo = await registerViaUi(customer, papa, ['ポチ']);
  const mamaNo = await registerViaUi(customer, mama, ['ぽちくん']);
  await requestMerge(customer, papa, mama);
  await customer.close();

  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await adminLogin(page, 'admin');
  // 今日の来場の確認待ちの件数から、確認待ちの画面へ
  await page.getByRole('link', { name: /確認待ちが \d+件 あります/ }).click();
  await expect(page.getByRole('heading', { name: '確認待ち' })).toBeVisible();

  const row = page.getByRole('listitem', { name: `おうちをまとめる申請 ぽちくんのおうち ${mamaNo}` });
  await expect(row.getByText('ママさんから')).toBeVisible();
  await expect(row.getByText(papaNo)).toBeVisible();
  await row.getByRole('link', { name: '統合の画面に進む' }).click();

  // 2つのおうちが選ばれた状態で始まる。残すのは登録が古いパパのおうち
  await expect(page.getByRole('radiogroup', { name: '残す会員ID' }).getByRole('radio', { name: new RegExp(papaNo) })).toBeChecked();
  await page.getByRole('listitem', { name: 'ぽちくんの組み合わせ' }).getByRole('radio', { name: 'ポチ', exact: true }).check();
  await page.getByRole('button', { name: 'まとめる', exact: true }).click();
  await page.getByRole('dialog', { name: 'おうちをまとめる' }).getByRole('button', { name: 'まとめる' }).click();
  await expect(page.getByRole('status')).toContainText('にまとめました');

  await page.getByRole('link', { name: '確認待ちにもどる' }).click();
  await expect(page.getByRole('listitem', { name: new RegExp(mamaNo) })).toHaveCount(0);
  await page.getByRole('tab', { name: '処理済み' }).click();
  const done = page.getByRole('listitem', { name: `おうちをまとめる申請 ぽちくんのおうち ${mamaNo}` });
  await expect(done.getByText(/^承認/)).toBeVisible();
  await expect(done.getByText(`統合済み → ${papaNo}`)).toBeVisible();
});

test('A-08 違う家族の申請は、理由を選んで却下できる', async ({ browser }) => {
  test.setTimeout(90_000);
  const customer = await browser.newPage();
  const a = newLineUser('たろう');
  const b = newLineUser('はなこ');
  await registerViaUi(customer, a, ['マル']);
  const bNo = await registerViaUi(customer, b, ['シカク']);
  await requestMerge(customer, a, b);
  await customer.close();

  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await adminLogin(page, 'admin', '/requests');
  await page.getByRole('link', { name: '確認待ち' }).click();
  const row = page.getByRole('listitem', { name: `おうちをまとめる申請 シカクのおうち ${bNo}` });
  await row.getByRole('button', { name: '却下する' }).click();
  const dialog = page.getByRole('dialog', { name: '申請を却下する' });
  await expect(dialog.getByRole('button', { name: 'やめる' })).toBeFocused();
  await dialog.getByRole('radio', { name: '同じ家族ではない' }).check();
  await dialog.getByRole('button', { name: '却下する' }).click();
  await expect(row).toHaveCount(0);

  await page.getByRole('tab', { name: '処理済み' }).click();
  const done = page.getByRole('listitem', { name: `おうちをまとめる申請 シカクのおうち ${bNo}` });
  await expect(done.getByText(/^却下/)).toBeVisible();
  await expect(done.getByText(/理由: 同じ家族ではない/)).toBeVisible();
});
