import { expect, test } from '@playwright/test';
import { newLineUser, openLiff, registerViaUi } from './helpers';

test('C-09 プロフィールでアンケートの回答を変えられる', async ({ page }) => {
  const user = newLineUser('ママ');
  await registerViaUi(page, user, ['アル']);
  await openLiff(page, user);
  await page.getByRole('link', { name: 'プロフィール' }).click();
  await expect(page.getByRole('heading', { name: 'プロフィール' })).toBeVisible();

  // 登録のときの回答が入っている
  const age = page.getByRole('radiogroup', { name: /年代/ });
  await expect(age.getByRole('radio', { name: '30代' })).toBeChecked();
  await expect(page.getByRole('radiogroup', { name: /きっかけ/ }).getByRole('radio', { name: 'Instagram' })).toBeChecked();
  await expect(page.getByRole('region', { name: 'おうちについて' })).toContainText('家族みんなで共通');

  await age.getByRole('radio', { name: '40代' }).check();
  await page.getByLabel('お住まいの郵便番号').fill('12345');
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(page.getByRole('alert')).toContainText('7桁');

  await page.getByLabel('お住まいの郵便番号').fill('123-4567');
  await page.getByRole('radiogroup', { name: /来場手段/ }).getByRole('radio', { name: '車', exact: true }).check();
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(page.getByRole('status')).toContainText('保存しました');
  await expect(page.getByLabel('お住まいの郵便番号')).toHaveValue('1234567');

  // 開き直しても変わっている
  await openLiff(page, user, '/profile');
  await expect(page.getByRole('radiogroup', { name: /年代/ }).getByRole('radio', { name: '40代' })).toBeChecked();
  await expect(page.getByRole('radiogroup', { name: /来場手段/ }).getByRole('radio', { name: '車', exact: true })).toBeChecked();
  await expect(page.getByLabel('お住まいの郵便番号')).toHaveValue('1234567');
});
