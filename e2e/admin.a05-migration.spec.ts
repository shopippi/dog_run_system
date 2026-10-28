import { expect, test } from '@playwright/test';
import { adminLogin, makePhoto, newLineUser, registerViaUi } from './helpers';
import { insertMigrationRequest, putMedia } from './merge-helpers';

test('A-05 受付で旧カードを見せてもらい、おうちを探してポイントを引き継ぐ。同じ種類は2回目を入れられない', async ({ browser }) => {
  test.setTimeout(90_000);
  const customer = await browser.newPage();
  const memberNo = await registerViaUi(customer, newLineUser('パパ'), ['コテツ']);
  await customer.close();

  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await adminLogin(page, 'admin', '/requests');
  await page.getByRole('link', { name: '確認待ち' }).click();
  await page.getByRole('tab', { name: '受付で直接入力' }).click();
  const picker = page.getByRole('group', { name: '引き継ぐおうちを探す' });
  await picker.getByRole('searchbox', { name: '探す言葉' }).fill(memberNo);
  await picker.getByRole('list', { name: '引き継ぐおうちを探すの候補' }).getByRole('button', { name: new RegExp(memberNo) }).click();

  const section = page.getByRole('region', { name: '受付で直接入力' });
  await section.getByRole('radio', { name: '紙のスタンプカード' }).check();
  await section.getByLabel('旧カードのポイント数').fill('12');
  await expect(section.getByText('ポイント数を 0〜99 の数字で入れてください。')).toHaveCount(0);
  await expect(section.getByText(/引き継ぎ後 2ポイント/)).toBeVisible();
  await expect(section.getByText(/無料券を1枚発行します/)).toBeVisible();
  await section.getByLabel('旧カードのポイント数').fill('100');
  await expect(section.getByRole('button', { name: '引き継ぐ' })).toBeDisabled();
  await section.getByLabel('旧カードのポイント数').fill('7');
  await section.getByRole('button', { name: '引き継ぐ' }).click();
  const dialog = page.getByRole('dialog', { name: '旧カードのポイントを引き継ぐ' });
  await expect(dialog.getByRole('button', { name: 'やめる' })).toBeFocused();
  await expect(dialog).toContainText('0 → 7ポイント');
  await dialog.getByRole('button', { name: '引き継ぐ' }).click();
  await expect(section.getByText('紙のスタンプカードの7ポイントを引き継ぎました。いまのポイントは7ポイントです。')).toBeVisible();
  // 同じ種類のカードは2回目を入れられない
  await expect(section.getByRole('radio', { name: /紙のスタンプカード\(引き継ぎ済み\)/ })).toBeDisabled();
  await expect(section.getByRole('radio', { name: 'LINEのショップカード' })).toBeChecked();
});

test('A-05 旧カードの引き継ぎ申請を、写真を見てポイント数を直して承認する', async ({ browser }) => {
  test.setTimeout(90_000);
  const customer = await browser.newPage();
  const memberNo = await registerViaUi(customer, newLineUser('ママ'), ['ムサシ']);
  const key = `requests/${memberNo}/card-${Date.now()}.jpg`;
  putMedia(key, await makePhoto(customer, 800, 600));
  insertMigrationRequest(memberNo, { source: 'line_card', claimedPoints: 8, note: '最後のスタンプが薄いです' }, key);
  await customer.close();

  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await adminLogin(page, 'admin', '/requests');
  await page.getByRole('link', { name: '確認待ち' }).click();
  const row = page.getByRole('listitem', { name: `旧カードの引き継ぎ ムサシのおうち ${memberNo}` });
  await expect(row.getByText('LINEのショップカード 8ポイント')).toBeVisible();
  await row.getByRole('button', { name: '確かめて承認する' }).click();
  const dialog = page.getByRole('dialog', { name: '旧カードの引き継ぎを承認する' });
  await expect(dialog.getByRole('img', { name: '旧カードの写真' })).toBeVisible();
  await expect(dialog.getByLabel('引き継ぐポイント数')).toHaveValue('8');
  await expect(dialog.getByRole('radio', { name: 'LINEのショップカード' })).toBeChecked();
  await dialog.getByLabel('引き継ぐポイント数').fill('6');
  await expect(dialog.getByText(/引き継ぎ後 6ポイント/)).toBeVisible();
  await dialog.getByRole('button', { name: '承認する' }).click();
  await expect(row).toHaveCount(0);

  await page.getByRole('tab', { name: '処理済み' }).click();
  const done = page.getByRole('listitem', { name: `旧カードの引き継ぎ ムサシのおうち ${memberNo}` });
  await expect(done.getByText(/^承認/)).toBeVisible();
  await expect(done.getByText(/6ポイントで承認\(申請は8ポイント\)/)).toBeVisible();
});
