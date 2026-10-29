import { expect, test } from '@playwright/test';
import { adminLogin, adminToast, newLineUser, openLiff, registerViaUi } from './helpers';
import { visitYesterday } from './merge-helpers';

test('A-07 2つのおうちを選び、同じワンちゃんを組み合わせてまとめる。まとめた後は元に戻せる', async ({ browser }) => {
  test.setTimeout(90_000);
  // パパのおうち(先に登録)とママのおうち。同じ子を別々に登録していた
  const customer = await browser.newPage();
  const papa = newLineUser('パパ');
  const mama = newLineUser('ママ');
  const papaNo = await registerViaUi(customer, papa, ['ゴマ']);
  const mamaNo = await registerViaUi(customer, mama, ['ごまちゃん', 'キナコ']);
  // 2つのおうちとも、昨日来場していた(今日の来場の一覧を長くしないよう、昨日の来場として入れる)
  visitYesterday(papaNo);
  visitYesterday(mamaNo);

  const admin = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await admin.newPage();
  // 確認待ちの画面から、おうちの統合を開く
  await adminLogin(page, 'admin', '/requests');
  await page.getByRole('link', { name: 'おうちの統合を開く' }).click();

  // 1. 2つのおうちを探して選ぶ(あとから登録したママのおうちを先に選ぶ)
  const picker1 = page.getByRole('group', { name: 'おうち1を探す' });
  await picker1.getByRole('searchbox', { name: '探す言葉' }).fill(mamaNo);
  await picker1.getByRole('list', { name: 'おうち1を探すの候補' }).getByRole('button', { name: new RegExp(mamaNo) }).click();
  const picker2 = page.getByRole('group', { name: 'おうち2を探す' });
  await picker2.getByRole('searchbox', { name: '探す言葉' }).fill(papaNo);
  await picker2.getByRole('list', { name: 'おうち2を探すの候補' }).getByRole('button', { name: new RegExp(papaNo) }).click();

  // 2. 残す会員IDの初期値は、登録が古いパパのおうち
  const keep = page.getByRole('radiogroup', { name: '残す会員ID' });
  await expect(keep.getByRole('radio', { name: new RegExp(papaNo) })).toBeChecked();

  // 3. ごまちゃんとゴマは同じ子。写真・名前・犬種は、ごまちゃんの方を残す
  const pairing = page.getByRole('listitem', { name: 'ごまちゃんの組み合わせ' });
  await pairing.getByRole('radio', { name: 'ゴマ', exact: true }).check();
  await pairing.getByRole('radio', { name: /^ごまちゃん/ }).check();

  // 4. まとめた後: 犬は2頭(ごまちゃん・キナコ)、ポイントは 1 + 1 = 2、来場は両方残る
  const result = page.getByRole('region', { name: '4. まとめた後' });
  await expect(result.getByText('ごまちゃん・キナコのおうち')).toBeVisible();
  await expect(result.getByText('1 + 1 = 2ポイント')).toBeVisible();
  await expect(result.getByText(/両方のおうちが来場しています/)).toBeVisible();

  await page.getByRole('button', { name: 'まとめる', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'おうちをまとめる' });
  await expect(dialog.getByRole('button', { name: 'やめる' })).toBeFocused();
  await expect(dialog).toContainText(`${mamaNo})を、`);
  await dialog.getByRole('button', { name: 'まとめる' }).click();
  await expect(adminToast(page, `ごまちゃん・キナコのおうち(${papaNo})にまとめました`)).toBeVisible();

  // ママの会員証も、パパの会員IDになる
  await openLiff(customer, mama);
  await expect(customer.getByText(papaNo)).toBeVisible();

  // 使わなくなった会員IDを探すと、統合先が出る
  const search = await admin.newPage();
  await search.goto('/admin/search');
  await search.getByRole('searchbox', { name: '探す言葉' }).fill(mamaNo);
  await expect(search.getByRole('list', { name: '見つかったおうち' }).getByText(`統合済み → ${papaNo}`)).toBeVisible();
  await search.close();

  // 元に戻す(この画面から)
  await page.getByRole('button', { name: '元に戻す' }).click();
  const undo = page.getByRole('dialog', { name: '統合を元に戻す' });
  await undo.getByRole('button', { name: '元に戻す' }).click();
  await expect(adminToast(page, '元に戻しました')).toBeVisible();
  await openLiff(customer, mama);
  await expect(customer.getByText(mamaNo)).toBeVisible();
  await customer.close();
  await admin.close();
});

test('A-07 受付スタッフは、おうちの統合を使えない', async ({ page }) => {
  await adminLogin(page, 'staff', '/merge');
  await expect(page.getByText('おうちの統合は、管理者のアカウントで行ってください。')).toBeVisible();
  await expect(page.getByRole('group', { name: 'おうち1を探す' })).toHaveCount(0);
});
