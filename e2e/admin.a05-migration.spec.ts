import { expect, test } from '@playwright/test';
import { adminLogin, newLineUser, openLiff, registerViaUi } from './helpers';
import { insertMigrationRequest } from './merge-helpers';

test('A-05 受付で旧カードを確かめて直接入力する。確認の印が2つともないと引き継げない。上限を超えると入れられない。同じ種類は2回目を入れられない', async ({ browser }) => {
  test.setTimeout(90_000);
  const customer = await browser.newPage();
  const user = newLineUser('パパ');
  const memberNo = await registerViaUi(customer, user, ['ダイフク']);

  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await adminLogin(page, 'admin');
  await page.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: '旧カードの引き継ぎ' }).click();
  await expect(page.getByRole('heading', { name: '旧カードの引き継ぎ' })).toBeVisible();
  // 「確認待ち」のメニューと件数の印はない
  await expect(page.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: '確認待ち' })).toHaveCount(0);

  const picker = page.getByRole('group', { name: '引き継ぐおうちを探す' });
  await picker.getByRole('searchbox', { name: '探す言葉' }).fill(memberNo);
  await picker.getByRole('list', { name: '引き継ぐおうちを探すの候補' }).getByRole('button', { name: new RegExp(memberNo) }).click();

  const section = page.getByRole('region', { name: '直接入力' });
  await section.getByRole('radio', { name: '紙のスタンプカード' }).check();
  await section.getByLabel('旧カードのポイント数').fill('31');
  await expect(section.getByText('引き継げるポイントは最大30ポイントです。')).toBeVisible();
  await expect(section.getByRole('button', { name: '引き継ぐ' })).toBeDisabled();
  await section.getByLabel('旧カードのポイント数').fill('12');
  await expect(section.getByText(/引き継ぎ後 12ポイント/)).toBeVisible();
  // 確認の印が2つそろうまで押せない
  await expect(section.getByRole('button', { name: '引き継ぐ' })).toBeDisabled();
  await section.getByLabel('旧カードを目で確かめた').check();
  await expect(section.getByRole('button', { name: '引き継ぐ' })).toBeDisabled();
  await section.getByLabel('紙のカードは回収した(または使用済みの印を付けた)').check();
  await section.getByRole('button', { name: '引き継ぐ' }).click();
  const dialog = page.getByRole('dialog', { name: '旧カードのポイントを引き継ぐ' });
  await expect(dialog.getByRole('button', { name: 'やめる' })).toBeFocused();
  await expect(dialog).toContainText('0 → 12ポイント');
  await dialog.getByRole('button', { name: '引き継ぐ' }).click();
  await expect(section.getByText('紙のスタンプカードの12ポイントを引き継ぎました。いまのポイントは12ポイントです。')).toBeVisible();
  // 10ポイントを超えても、無料券には自動で替えない(お客さんが会員証で交換する)
  await openLiff(customer, user);
  await expect(customer.getByRole('button', { name: '無料券と交換する(10ポイント)' })).toBeVisible();
  await expect(customer.getByText('使える無料券はありません')).toBeVisible();
  await customer.close();

  // 同じ種類のカードは2回目を入れられない。入力の印は外れている
  await expect(section.getByRole('radio', { name: /紙のスタンプカード\(引き継ぎ済み\)/ })).toBeDisabled();
  await expect(section.getByRole('radio', { name: 'LINEのショップカード' })).toBeChecked();
  await expect(section.getByLabel('旧カードを目で確かめた')).not.toBeChecked();

  // 引き継ぎ済みの一覧に、いつ・誰が・どのおうち・何ポイントが出る
  const list = page.getByRole('region', { name: '引き継ぎ済みの一覧' });
  const row = list.getByRole('listitem', { name: `ダイフクのおうち ${memberNo} 紙のスタンプカード` });
  await expect(row).toContainText('12ポイント');
  await expect(row).toContainText('管理者');
});

test('A-05 引き継ぎ済みの一覧から元に戻すと、もう一度入力できる。以前に届いた引き継ぎの申請は、確認待ちで却下だけできる', async ({ browser }) => {
  test.setTimeout(90_000);
  const customer = await browser.newPage();
  const memberNo = await registerViaUi(customer, newLineUser('ママ'), ['コジロウ']);
  insertMigrationRequest(memberNo, { source: 'line_card', claimedPoints: 8, note: '最後のスタンプが薄いです' }, null);
  await customer.close();

  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await adminLogin(page, 'admin', '/migration');
  const picker = page.getByRole('group', { name: '引き継ぐおうちを探す' });
  await picker.getByRole('searchbox', { name: '探す言葉' }).fill(memberNo);
  await picker.getByRole('list', { name: '引き継ぐおうちを探すの候補' }).getByRole('button', { name: new RegExp(memberNo) }).click();
  const section = page.getByRole('region', { name: '直接入力' });
  await section.getByRole('radio', { name: 'LINEのショップカード' }).check();
  await section.getByLabel('旧カードのポイント数').fill('5');
  await section.getByLabel('旧カードを目で確かめた').check();
  await section.getByLabel('紙のカードは回収した(または使用済みの印を付けた)').check();
  await section.getByRole('button', { name: '引き継ぐ' }).click();
  await page.getByRole('dialog', { name: '旧カードのポイントを引き継ぐ' }).getByRole('button', { name: '引き継ぐ' }).click();
  await expect(section.getByRole('radio', { name: /LINEのショップカード\(引き継ぎ済み\)/ })).toBeDisabled();

  const list = page.getByRole('region', { name: '引き継ぎ済みの一覧' });
  const row = list.getByRole('listitem', { name: `コジロウのおうち ${memberNo} LINEのショップカード` });
  await row.getByRole('button', { name: '元に戻す' }).click();
  const undo = page.getByRole('dialog', { name: '引き継ぎを元に戻す' });
  await expect(undo.getByRole('button', { name: 'やめる' })).toBeFocused();
  await expect(undo).toContainText('5ポイント');
  await undo.getByRole('button', { name: '元に戻す' }).click();
  await expect(list.getByText(/の引き継ぎを元に戻しました。/)).toBeVisible();
  await expect(row.getByText(/^元に戻しました/)).toBeVisible();
  await expect(row.getByRole('button', { name: '元に戻す' })).toHaveCount(0);

  // 以前の申請: 確認待ちには却下だけがある(承認のボタンはない)
  await page.goto('/admin/requests');
  const req = page.getByRole('listitem', { name: `旧カードの引き継ぎ コジロウのおうち ${memberNo}` });
  await expect(req).toBeVisible();
  await expect(req.getByRole('button', { name: '確かめて承認する' })).toHaveCount(0);
  await req.getByRole('button', { name: '却下する' }).click();
  const reject = page.getByRole('dialog', { name: '申請を却下する' });
  await reject.getByRole('radio', { name: 'すでに引き継ぎ済み' }).check();
  await reject.getByRole('button', { name: '却下する' }).click();
  await expect(req).toHaveCount(0);
});
