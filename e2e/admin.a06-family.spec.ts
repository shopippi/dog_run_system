import { expect, test } from '@playwright/test';
import { adminLogin, newLineUser, openLiff, registerViaUi } from './helpers';

test('A-06 受付で招待QRを出して家族を追加し、確認してから外し、操作ログから元に戻す', async ({ browser }) => {
  const customer = await browser.newPage();
  const papa = newLineUser('パパ');
  const memberNo = await registerViaUi(customer, papa, ['ムサシマル']);

  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await adminLogin(page, 'admin');
  await page.getByRole('link', { name: 'おうちを探す' }).click();
  await page.getByRole('searchbox', { name: '探す言葉' }).fill('むさしまる');
  await page.getByRole('link', { name: 'ムサシマルのおうちの詳細を開く' }).click();
  // 1人だけのときは「外す」が出ない
  await expect(page.getByRole('list', { name: '家族' }).getByRole('button', { name: /を外す/ })).toHaveCount(0);

  const created = page.waitForResponse((r) => r.url().includes('/invite-qr') && r.status() === 201);
  await page.getByRole('button', { name: '家族を追加' }).click();
  const dialog = page.getByRole('dialog', { name: '家族を追加' });
  await expect(dialog.getByRole('img', { name: '家族の招待のQRコード' })).toBeVisible();
  await expect(dialog.getByRole('timer')).toContainText(/あと 9:5\d 使えます/);
  const { url } = (await (await created).json()) as { url: string };
  expect(url).toMatch(/^\/liff\/invite\/[A-Za-z0-9_-]+$/);

  // 家族が QR を読み取って参加する(LIFF はモック)
  const mama = newLineUser('ママ');
  await openLiff(customer, mama, url.replace('/liff', ''));
  await expect(customer.getByRole('heading', { name: 'ムサシマルのおうちに参加しますか?' })).toBeVisible();
  await customer.getByRole('radiogroup', { name: /年代/ }).getByRole('radio', { name: '40代' }).check();
  await customer.getByRole('radiogroup', { name: /性別/ }).getByRole('radio', { name: '女性' }).check();
  await customer.getByLabel('利用規約とプライバシーポリシーに同意します').check();
  await customer.getByRole('button', { name: '参加する' }).click();
  await expect(customer.getByText('参加しました')).toBeVisible();

  await dialog.getByRole('button', { name: '閉じる' }).click();
  const family = page.getByRole('list', { name: '家族' });
  await expect(family).toContainText('ママさん');
  await expect(family).toContainText('受付で参加');

  // 外す(確認してから)
  await family.getByRole('button', { name: 'ママさんを外す' }).click();
  const confirm = page.getByRole('dialog', { name: '家族を外す' });
  await expect(confirm).toContainText('ポイント(0ポイント)・無料券(0枚)・来場の記録は、おうちに残ります');
  await expect(confirm).toContainText('残る家族: パパさん');
  await confirm.getByRole('button', { name: '外す' }).click();
  await expect(page.getByRole('status')).toContainText('ママさんを外しました');
  await expect(family.getByRole('listitem').filter({ hasText: 'ママさん' })).toContainText('外れた');

  // 操作ログから元に戻す
  await page.getByRole('status').getByRole('link', { name: '操作ログ' }).click();
  const row = page
    .getByRole('list', { name: '操作の一覧' })
    .getByRole('listitem')
    .filter({ has: page.getByText('家族を外す', { exact: true }) })
    .filter({ hasText: memberNo });
  await row.getByRole('button', { name: '元に戻す' }).click();
  await page.getByRole('dialog', { name: '操作を元に戻す' }).getByRole('button', { name: '元に戻す' }).click();
  await expect(row.getByText('元に戻し済み')).toBeVisible();

  await openLiff(customer, mama);
  await expect(customer.getByRole('region', { name: '会員証' }).getByText(memberNo)).toBeVisible();
});
