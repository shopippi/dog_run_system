import { expect, test } from '@playwright/test';
import { newLineUser, openLiff } from './helpers';

test('C-03 アンケートの必須に答えないと登録できず、郵便番号は任意', async ({ page }) => {
  await openLiff(page, newLineUser('ばあば'));
  await page.getByLabel('利用規約とプライバシーポリシーに同意します').check();
  await page.getByRole('button', { name: '同意して次へ' }).click();
  const form = page.locator('fieldset.dog-form').first();
  await form.getByLabel('名前').fill('モモ');
  await form.getByRole('combobox', { name: /犬種/ }).selectOption({ label: 'チワワ' });
  await page.getByRole('button', { name: '次へ' }).click();

  await expect(page.getByRole('heading', { name: 'かんたんなアンケート' })).toBeVisible();
  await page.getByRole('radiogroup', { name: /年代/ }).getByRole('radio', { name: '60代' }).check();
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page.getByRole('alert')).toHaveText('「性別」に答えてください。');

  await page.getByRole('radiogroup', { name: /性別/ }).getByRole('radio', { name: '答えない' }).check();
  await page.getByRole('radiogroup', { name: /きっかけ/ }).getByRole('radio', { name: '通りがかり' }).check();
  await page.getByRole('textbox', { name: /郵便番号/ }).fill('12-3');
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page.getByRole('alert')).toContainText('7桁');

  await page.getByRole('textbox', { name: /郵便番号/ }).fill('');
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page.getByText('登録が完了しました')).toBeVisible();
});
