import { expect, test } from '@playwright/test';
import { adminLogin } from './helpers';

// A-12 ルールの設定(M-13)
// データベースはほかのテストと共有するため、変えた設定はテストの最後に元に戻す。

test('A-12 管理者が無料券に必要なポイント数を変えて保存すると、読み込み直しても残る', async ({ page }) => {
  await adminLogin(page, 'admin', '/settings');
  const section = page.getByRole('region', { name: 'ポイントと無料券' });
  const field = section.getByLabel('無料券1枚に必要なポイント数');
  await expect(field).toHaveValue('10');
  const save = section.getByRole('button', { name: '保存する' });
  await expect(save).toBeDisabled();

  await field.fill('0');
  await save.click();
  await expect(section.getByRole('alert')).toContainText('「無料券1枚に必要なポイント数」は、1〜100の数で入れてください。');

  await field.fill('8');
  await section.getByRole('radiogroup', { name: '無料券の有効期限' }).getByRole('radio', { name: 'もらった日から' }).click();
  await section.getByLabel('無料券の有効期限(か月)').fill('6');
  await save.click();
  await expect(section.getByRole('status')).toHaveText('保存しました。');

  await page.reload();
  const again = page.getByRole('region', { name: 'ポイントと無料券' });
  await expect(again.getByLabel('無料券1枚に必要なポイント数')).toHaveValue('8');
  const ticketExpiry = again.getByRole('radiogroup', { name: '無料券の有効期限' });
  await expect(ticketExpiry.getByRole('radio', { name: 'もらった日から' })).toHaveAttribute('aria-checked', 'true');
  await expect(again.getByLabel('無料券の有効期限(か月)')).toHaveValue('6');

  // 元に戻す
  await again.getByLabel('無料券1枚に必要なポイント数').fill('10');
  await ticketExpiry.getByRole('radio', { name: '期限なし' }).click();
  await again.getByRole('button', { name: '保存する' }).click();
  await expect(again.getByRole('status')).toHaveText('保存しました。');
});

test('A-12 受付のQRコードの合言葉を作り直すと、QRコードの中身が変わる', async ({ page }) => {
  await adminLogin(page, 'admin', '/settings');
  const section = page.getByRole('region', { name: '受付のQRコード' });
  await expect(section.getByRole('img', { name: '受付のQRコード' })).toBeVisible();
  const passphrase = section.getByTestId('passphrase');
  const old = (await passphrase.textContent())!.trim();
  await expect(section.getByText(`/liff/checkin?k=${old}`)).toBeVisible();

  await section.getByRole('button', { name: '合言葉を作り直す' }).click();
  const dialog = page.getByRole('dialog', { name: '受付のQRコードを作り直す' });
  await expect(dialog.getByRole('button', { name: 'やめる' })).toBeFocused();
  await expect(dialog).toContainText('前に印刷したQRコードでは、チェックインできなくなります');
  await dialog.getByRole('button', { name: '作り直す' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(passphrase).not.toHaveText(old);
  const fresh = (await passphrase.textContent())!.trim();
  await expect(section.getByText(`/liff/checkin?k=${fresh}`)).toBeVisible();

  // ほかのテストが前の合言葉を使うので、元に戻す
  const res = await page.request.patch('/admin/api/settings', { headers: { 'x-dr-admin': '1' }, data: { checkin_passphrase: old } });
  expect(res.status()).toBe(200);
});

test('A-12 製作者は見るだけ(入力欄は押せず、保存のボタンもない)。受付スタッフには画面が出ない', async ({ browser }) => {
  const dev = await browser.newPage();
  await adminLogin(dev, 'developer', '/settings');
  const section = dev.getByRole('region', { name: 'ポイントと無料券' });
  await expect(section.getByLabel('無料券1枚に必要なポイント数')).toBeDisabled();
  await expect(dev.getByRole('button', { name: '保存する' })).toHaveCount(0);
  await expect(dev.getByRole('button', { name: '合言葉を作り直す' })).toHaveCount(0);
  await dev.close();

  const staff = await browser.newPage();
  await adminLogin(staff, 'staff');
  await expect(staff.getByRole('link', { name: 'ルール' })).toHaveCount(0);
  await staff.goto('/admin/settings');
  await expect(staff.getByRole('alert')).toContainText('この操作をする権限がありません');
  await staff.close();
});
