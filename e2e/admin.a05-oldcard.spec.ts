import { expect, test, type Page } from '@playwright/test';
import { adminLogin, adminToast, newLineUser, openLiff, registerViaUi } from './helpers';
import { sql } from './merge-helpers';
import { householdIdOf } from './tickets-helpers';

// A-05 旧カードの引き継ぎの、受付での通しの流れ(16章)。
// おうちの詳細から選んだ状態で開く → 上限を超えるカード(上限までになることを伝えた印)・特典を無料券に・カードの番号 →
// 同じ番号のカードをほかのおうちで入れると知らせる → 一覧をカードの番号で探す → 移行期間のまとめ。お客さんの会員証の案内と来場履歴。

async function pickByMember(page: Page, memberNo: string) {
  const picker = page.getByRole('group', { name: '引き継ぐおうちを探す' });
  await picker.getByRole('searchbox', { name: '探す言葉' }).fill(memberNo);
  await picker.getByRole('list', { name: '引き継ぐおうちを探すの候補' }).getByRole('button', { name: new RegExp(memberNo) }).click();
}

test('A-05 受付の流れ: おうちの詳細から開き、上限を超えるカード・特典・カードの番号を入れる。同じ番号はほかのおうちで知らせる', async ({ browser }) => {
  test.setTimeout(150_000);
  const ref = `No.${Date.now().toString().slice(-6)}`;
  const customer = await browser.newPage();
  const papa = newLineUser('パパ');
  const memberNo = await registerViaUi(customer, papa, ['ベンジャミン']);
  // 会員証に、前のカードの案内が出ている
  await openLiff(customer, papa);
  const notice = customer.getByRole('region', { name: '前のカードのポイントを引き継げます' });
  await expect(notice).toContainText('受付で前のカード(LINEのショップカード・紙のカード)を見せてください。たまっているポイントを引き継げます。');

  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await adminLogin(page, 'admin');
  const id = await householdIdOf(page, memberNo);
  await page.goto(`/admin/households/${id}`);
  await page.getByRole('link', { name: '旧カードを引き継ぐ' }).click();
  await expect(page).toHaveURL(/\/admin\/migration\?member=/);
  // 選んだ状態で開く
  const slot = page.getByRole('group', { name: '引き継ぐおうち' });
  await expect(slot).toContainText(memberNo);

  const section = page.getByRole('region', { name: '直接入力' });
  await section.getByRole('radio', { name: '紙のスタンプカード' }).check();
  await section.getByLabel('旧カードのポイント数').fill('35');
  await expect(section.getByText('引き継げるのは最大30ポイントです。35ポイントのうち30ポイントを引き継ぎ、残りの5ポイントは引き継がれません。')).toBeVisible();
  await expect(section.getByText(/引き継ぎ後 30ポイント/)).toBeVisible();
  await section.getByLabel('使っていない特典').fill('2');
  await expect(section.getByText('旧カードの特典から出せる無料券は、最大1枚です。')).toBeVisible();
  await section.getByLabel('使っていない特典').fill('1');
  await section.getByLabel('カードの番号(任意)').fill(ref);
  await section.getByLabel('旧カードを目で確かめた').check();
  await section.getByLabel('紙のカードは回収した(または使用済みの印を付けた)').check();
  // 上限までになることを伝えた印がないと押せない
  await expect(section.getByRole('button', { name: '引き継ぐ' })).toBeDisabled();
  await section.getByLabel('上限までになることを、お客さんに伝えた').check();
  await section.getByRole('button', { name: '引き継ぐ' }).click();
  const dialog = page.getByRole('dialog', { name: '旧カードのポイントを引き継ぐ' });
  await expect(dialog).toContainText('0 → 30ポイント');
  await expect(dialog).toContainText('上限を超える5ポイントは引き継ぎません');
  await expect(dialog).toContainText('無料券1枚');
  await dialog.getByRole('button', { name: '引き継ぐ' }).click();
  await expect(adminToast(page, 'パパさんの紙のスタンプカードの30ポイントと無料券1枚を引き継ぎました。いまのポイントは30ポイントです。')).toBeVisible();

  const list = page.getByRole('region', { name: '引き継ぎ済みの一覧' });
  const row = list.getByRole('listitem', { name: `ベンジャミンのおうち ${memberNo} 紙のスタンプカード` });
  await expect(row).toContainText('旧カード 35');
  await expect(row).toContainText('無料券 1枚');
  await expect(row).toContainText(`番号 ${ref}`);
  const summary = page.getByRole('region', { name: '移行期間' });
  await expect(summary).toContainText('引き継いだおうち');
  await expect(summary).toContainText('上限を超えていたカード');

  // お客さん: 案内は消え、来場履歴に引き継ぎの記録、無料券が1枚
  await openLiff(customer, papa);
  await customer.getByText('未使用 1枚').waitFor();
  await expect(customer.getByRole('region', { name: '前のカードのポイントを引き継げます' })).toHaveCount(0);
  await openLiff(customer, papa, '/history');
  const hist = customer.getByRole('region', { name: '前のカードからの引き継ぎ' });
  await expect(hist).toContainText('前のカードから 30ポイント 引き継ぎ');
  await expect(hist).toContainText('あなたの紙のスタンプカード・無料券1枚');
  await customer.close();

  // 同じ番号のカードを、ほかのおうちで入れようとする
  const other = await browser.newPage();
  const mamaNo = await registerViaUi(other, newLineUser('ママ'), ['クレオパトラ']);
  await other.close();
  await section.getByRole('button', { name: '選び直す' }).click();
  await pickByMember(page, mamaNo);
  await section.getByRole('radio', { name: '紙のスタンプカード' }).check();
  await section.getByLabel('旧カードのポイント数').fill('4');
  await section.getByLabel('カードの番号(任意)').fill(ref.replace('No.', ''));
  await section.getByLabel('旧カードを目で確かめた').check();
  await section.getByLabel('紙のカードは回収した(または使用済みの印を付けた)').check();
  await section.getByRole('button', { name: '引き継ぐ' }).click();
  await dialog.getByRole('button', { name: '引き継ぐ' }).click();
  await expect(dialog.getByRole('alert')).toContainText(`ベンジャミンのおうち(${memberNo})`);
  await expect(dialog.getByRole('alert')).toContainText('同じカードは1回しか引き継げません');
  const again = dialog.getByRole('button', { name: '別のカードとして引き継ぐ' });
  await expect(again).toBeDisabled();
  await dialog.getByLabel('カードを見比べて、別のカードだと確かめた').check();
  await again.click();
  await expect(adminToast(page, /ママさんの紙のスタンプカードの4ポイントを引き継ぎました/)).toBeVisible();
  await expect(summary.getByText(/同じカードの番号で引き継いだおうちが/)).toBeVisible();

  // 一覧をカードの番号で探す
  await list.getByRole('searchbox', { name: '引き継ぎ済みの一覧を探す' }).fill(ref.replace('No.', ''));
  await expect(list.getByRole('listitem', { name: new RegExp(memberNo) })).toContainText(`同じ番号: ${mamaNo}`);
  await expect(list.getByRole('listitem', { name: new RegExp(mamaNo) })).toContainText(`同じ番号: ${memberNo}`);
});

test('M-19 切り替えの手順: 旧カードの引き継ぎから開き、済んだ印を付けられる。LINEのショップカードを止める注意とお知らせの文がある', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await adminLogin(page, 'admin', '/migration');
  await page.getByRole('link', { name: '切り替えの手順' }).click();
  await expect(page.getByRole('heading', { name: '切り替えの手順', level: 1 })).toBeVisible();
  const end = page.getByRole('region', { name: '移行期間の終わり' });
  await expect(end).toContainText('止めると取り消せません。お客さんのLINEの中のポイントも含めて、すべての記録が消えます。');
  const step = page.getByLabel('LINEのリッチメニューを、新しい会員証に切り替える');
  await step.check();
  await page.reload();
  await expect(page.getByLabel('LINEのリッチメニューを、新しい会員証に切り替える')).toBeChecked();
  const text = page.getByLabel('お知らせの文', { exact: true });
  await expect(text).toContainText('受付で前のカード(LINEのショップカード・紙のカード)を見せてください。たまっているポイントを新しい会員証に引き継げます。');
  await expect(text).toContainText('からは、前のカード(LINEのショップカード・紙のカード)にはポイントが付きません。');
  await expect(page.getByRole('region', { name: '切り替えの日' })).toContainText('この日から、LINEのショップカードと紙のカードにはポイントを付けない');
  // 製作者も見られる(閲覧だけ)
  const dev = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await adminLogin(dev, 'developer', '/switchover');
  await expect(dev.getByRole('heading', { name: '切り替えの手順', level: 1 })).toBeVisible();
});

test('C-06 会員証の案内は「閉じる」でその家族には出なくなる', async ({ page }) => {
  const user = newLineUser('ママ');
  await registerViaUi(page, user, ['モモ']);
  await openLiff(page, user);
  const notice = page.getByRole('region', { name: '前のカードのポイントを引き継げます' });
  await notice.getByRole('button', { name: '閉じる' }).click();
  await expect(notice).toHaveCount(0);
  await openLiff(page, user);
  await page.getByRole('link', { name: '来場履歴' }).waitFor();
  await expect(page.getByRole('region', { name: '前のカードのポイントを引き継げます' })).toHaveCount(0);
});

test('A-05 パパとママのカードを、それぞれ引き継ぐ: だれのカードかを選び、このおうちで引き継いだカードの一覧に名前が出る', async ({ browser }) => {
  test.setTimeout(120_000);
  const customer = await browser.newPage();
  const papa = newLineUser('パパ');
  const memberNo = await registerViaUi(customer, papa, ['ルイボス']);
  // ママを同じおうちの家族にする(招待の画面を使わずに準備する)
  const mamaUser = newLineUser('ママ');
  sql(
    `INSERT INTO family_members (household_id, line_user_id, line_display_name, age_group, gender, consented_at, joined_at, join_method, status, updated_at)
     SELECT id, '${mamaUser.split(':')[0]}', 'ママ', '30代', '女性', '2026-10-01T00:00:00+09:00', '2026-10-01T00:00:00+09:00', 'invite', 'active', '2026-10-01T00:00:00+09:00'
       FROM households WHERE member_no = '${memberNo}'`,
  );
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await adminLogin(page, 'admin', `/migration?member=${memberNo}`);
  const section = page.getByRole('region', { name: '直接入力' });
  const who = section.getByRole('radiogroup', { name: 'だれのカード' });
  await expect(who.getByRole('radio')).toHaveCount(2);
  // 家族が2人で今日の来場がないので、初めはだれも選ばれていない
  await expect(section.getByText('受付の前にいる人のカードを選んでください')).toBeVisible();
  for (const [name, points] of [
    ['パパさん', '6'],
    ['ママさん', '9'],
  ] as const) {
    await who.getByRole('radio', { name }).check();
    await section.getByRole('radio', { name: 'LINEのショップカード', exact: true }).check();
    await section.getByLabel('旧カードのポイント数').fill(points);
    await section.getByLabel('旧カードを目で確かめた').check();
    await section.getByLabel('紙のカードは回収した(または使用済みの印を付けた)').check();
    await section.getByRole('button', { name: '引き継ぐ' }).click();
    const dialog = page.getByRole('dialog', { name: '旧カードのポイントを引き継ぐ' });
    await expect(dialog).toContainText(`${name}のLINEのショップカードから${points}ポイント`);
    await dialog.getByRole('button', { name: '引き継ぐ' }).click();
    await expect(adminToast(page, `${name}のLINEのショップカードの${points}ポイントを引き継ぎました。`)).toBeVisible();
  }
  const done = section.getByRole('list', { name: 'このおうちで引き継いだカード' });
  await expect(done).toContainText('パパさんのLINEのショップカード: 6ポイント');
  await expect(done).toContainText('ママさんのLINEのショップカード: 9ポイント');
  await expect(who.getByRole('radio', { name: 'ママさん(LINEのショップカードは済み)' })).toBeVisible();
  // ママの LINE のショップカードは選べない(済み)。紙のカードは選べる
  await who.getByRole('radio', { name: /ママさん/ }).check();
  await expect(section.getByRole('radio', { name: 'LINEのショップカード(引き継ぎ済み)' })).toBeDisabled();
  await expect(section.getByRole('radio', { name: '紙のスタンプカード', exact: true })).toBeChecked();

  // ママの会員証には、ママのカードの分も「あなたの」として記録が出る。案内はママにはもう出ない
  await openLiff(customer, mamaUser, '/history');
  const hist = customer.getByRole('region', { name: '前のカードからの引き継ぎ' });
  await expect(hist).toContainText('あなたのLINEのショップカード');
  await expect(hist).toContainText('パパさんのLINEのショップカード');
});
