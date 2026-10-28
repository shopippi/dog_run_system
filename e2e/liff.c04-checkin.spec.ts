import { expect, test } from '@playwright/test';
import { answerSurvey, newLineUser, openCheckin, registerViaUi } from './helpers';

test('C-04 受付のQRから開いて犬を選び、チェックインする。同じ日の2回目はポイントなし', async ({ page }) => {
  const user = newLineUser('パパ');
  await registerViaUi(page, user, ['アル', 'ニコ']);

  await openCheckin(page, user);
  await expect(page.getByRole('heading', { name: 'チェックイン' })).toBeVisible();
  const group = page.getByRole('group', { name: '今日来たワンちゃん' });
  await expect(group.getByRole('checkbox')).toHaveCount(2);
  // ニコはお留守番
  await group.getByRole('checkbox').nth(1).uncheck();
  await page.getByRole('button', { name: 'チェックインする' }).click();
  await expect(page).toHaveURL(/\/liff\/checkin\/done\/\d+/);

  // もう一度QRを読むと、チェックイン済みと出て、追加だけができる
  await openCheckin(page, user);
  await expect(page.getByText('今日はチェックイン済みです。')).toBeVisible();
  await expect(page.getByRole('group', { name: '今日来たワンちゃん' }).getByText('ニコ')).toBeVisible();
  await page.getByRole('button', { name: 'ワンちゃんを追加する' }).click();
  await expect(page).toHaveURL(/\/liff\/checkin\/done\/\d+/);
});

test('C-04 未登録の人が受付のQRを読むと、登録してからチェックインに進む(10.3)', async ({ page }) => {
  const user = newLineUser('はじめて');
  await openCheckin(page, user);
  await expect(page.getByRole('heading', { name: 'はじめての方へ' })).toBeVisible();
  await page.getByLabel('利用規約とプライバシーポリシーに同意します').check();
  await page.getByRole('button', { name: '同意して次へ' }).click();
  const form = page.locator('fieldset.dog-form').first();
  await form.getByLabel('名前').fill('ココ');
  await form.getByRole('combobox', { name: /犬種/ }).selectOption({ label: 'チワワ' });
  await page.getByRole('button', { name: '次へ' }).click();
  await answerSurvey(page);
  await page.getByRole('button', { name: '登録する' }).click();
  await page.getByRole('button', { name: '会員証を見る' }).click();

  await expect(page.getByRole('heading', { name: 'チェックイン' })).toBeVisible();
  await page.getByRole('button', { name: 'チェックインする' }).click();
  await expect(page).toHaveURL(/\/liff\/checkin\/done\/\d+/);
});
