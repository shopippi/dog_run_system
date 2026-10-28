import { expect, test } from '@playwright/test';
import { joinFamily } from './customer-helpers';
import { newLineUser, openLiff, registerViaUi } from './helpers';

test('C-13 家族の一覧を見て、自分がおうちから抜けると、新しいおうちとして登録し直せる', async ({ page, request }) => {
  const mama = newLineUser('ママ');
  const memberNo = await registerViaUi(page, mama, ['アル']);
  const papa = newLineUser('パパ');
  await joinFamily(request, mama, papa);

  await openLiff(page, papa);
  await page.getByRole('link', { name: '家族を招待' }).click();
  const members = page.getByRole('region', { name: 'いまの家族' });
  await expect(members.getByRole('listitem')).toHaveCount(2);
  await expect(members.getByRole('listitem').nth(0)).toContainText('ママ');
  await expect(members.getByRole('listitem').nth(0)).toContainText('はじめに登録');
  await expect(members.getByRole('listitem').nth(1)).toContainText('パパ(あなた)');
  await expect(members.getByRole('listitem').nth(1)).toContainText('招待で参加');

  // 確認してから抜ける。「やめる」で戻れる
  await page.getByRole('button', { name: 'このおうちから抜ける' }).click();
  await page.getByRole('button', { name: 'やめる' }).click();
  await page.getByRole('button', { name: 'このおうちから抜ける' }).click();
  await page.getByRole('button', { name: '抜ける', exact: true }).click();

  // 未登録の扱いになり、はじめての方の画面が出る。登録し直すと新しい会員ID
  await expect(page.getByRole('heading', { name: 'はじめての方へ' })).toBeVisible();
  const newNo = await registerViaUi(page, papa, ['モモ']);
  expect(newNo).not.toBe(memberNo);

  // ママの家族の一覧からはパパが外れ、最後の1人は抜けられない
  await openLiff(page, mama, '/family');
  await expect(page.getByRole('region', { name: 'いまの家族' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByText('抜けることはできません。退会したいときは、受付にお知らせください。')).toBeVisible();
  await expect(page.getByRole('button', { name: 'このおうちから抜ける' })).toHaveCount(0);
});
