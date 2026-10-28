import { expect, test } from '@playwright/test';
import { adminLogin, newLineUser, openLiff } from './helpers';

// A-11 犬種の選択肢の管理(M-12)

test('A-11 犬種を追加して上へ動かし、非表示にするとお客さんの選択肢から消える', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await adminLogin(page, 'admin', '/breeds');
  const name = `コーギー${Date.now().toString(36).slice(-4)}`;
  const add = page.getByRole('region', { name: '犬種を追加' });
  await add.getByLabel('追加する犬種の名前').fill(name);
  await add.getByRole('radio', { name: '中型' }).click();
  await add.getByRole('button', { name: '追加する' }).click();

  const list = page.getByRole('list', { name: '犬種' });
  const row = list.getByRole('listitem', { name: name, exact: true });
  await expect(row).toContainText('標準のサイズ 中型');
  // 「その他」の直前に入る
  await expect(list.getByRole('listitem').last()).toHaveAccessibleName('その他');
  await expect(list.getByRole('listitem').nth(-2)).toHaveAccessibleName(name);
  // 「その他」は上へ・下へ・非表示がない
  const other = list.getByRole('listitem', { name: 'その他' });
  await expect(other.getByRole('button', { name: /上へ|下へ|非表示/ })).toHaveCount(0);

  await row.getByRole('button', { name: `${name}を上へ` }).click();
  await expect(list.getByRole('listitem').nth(-3)).toHaveAccessibleName(name);

  // お客さんの選択肢に出る
  const customer = await browser.newPage();
  await openLiff(customer, newLineUser('ママ'));
  await customer.getByLabel('利用規約とプライバシーポリシーに同意します').check();
  await customer.getByRole('button', { name: '同意して次へ' }).click();
  const select = customer.locator('fieldset.dog-form').first().getByRole('combobox', { name: /犬種/ });
  await expect(select.locator('option', { hasText: name })).toHaveCount(1);

  await row.getByRole('button', { name: `${name}を非表示にする` }).click();
  await expect(row.getByText('非表示', { exact: true })).toBeVisible();
  await customer.reload();
  await customer.getByLabel('利用規約とプライバシーポリシーに同意します').check();
  await customer.getByRole('button', { name: '同意して次へ' }).click();
  await expect(customer.locator('fieldset.dog-form').first().getByRole('combobox', { name: /犬種/ }).locator('option', { hasText: name })).toHaveCount(0);

  // 名前を変える(ダイアログ)
  await row.getByRole('button', { name: `${name}を変える` }).click();
  const dialog = page.getByRole('dialog', { name: '犬種を変える' });
  await expect(dialog.getByRole('button', { name: 'やめる' })).toBeFocused();
  await dialog.getByLabel('犬種の名前').fill(`${name}2`);
  await dialog.getByRole('button', { name: '保存する' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(list.getByRole('listitem', { name: `${name}2`, exact: true })).toBeVisible();
  await customer.close();
  await page.close();
});

test('A-11 製作者は一覧を見るだけ(追加・並べ替えのボタンがない)', async ({ page }) => {
  await adminLogin(page, 'developer', '/breeds');
  await expect(page.getByRole('list', { name: '犬種' }).getByRole('listitem', { name: 'プードル' })).toBeVisible();
  await expect(page.getByRole('region', { name: '犬種を追加' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /上へ|下へ|変える|非表示/ })).toHaveCount(0);
});
