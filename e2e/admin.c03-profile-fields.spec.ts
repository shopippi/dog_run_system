import { expect, test, type Page } from '@playwright/test';
import { adminLogin, adminToast, newLineUser, registerViaUi } from './helpers';

// C-03 飼い主とワンちゃんの情報(管理画面: M-06 おうちの詳細・M-07 ワンちゃん・M-11 アンケート・M-05 ダッシュボード。担当J)

async function openHousehold(page: Page, search: string, name: string) {
  await page.getByRole('link', { name: 'おうちを探す' }).click();
  await page.getByRole('searchbox', { name: '探す言葉' }).fill(search);
  await page.getByRole('link', { name: `${name}の詳細を開く` }).click();
}

test('C-03 管理者が、おうちの回答(来たい時間帯など)とワンちゃんの体重・相性・予防注射を見て変えられる', async ({ browser }) => {
  const customer = await browser.newPage();
  await registerViaUi(customer, newLineUser('パパ'), ['ミツマメ']);
  await customer.close();

  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await adminLogin(page, 'admin');
  await openHousehold(page, 'みつまめ', 'ミツマメのおうち');

  // M-06 おうちの回答を変える
  const survey = page.getByRole('region', { name: 'アンケート' });
  await expect(survey).toContainText('来たい時間帯');
  await survey.getByRole('button', { name: 'おうちの回答を変える' }).click();
  const dialog = page.getByRole('dialog', { name: 'おうちの回答を変える' });
  await dialog.getByRole('group', { name: /来たい時間帯/ }).getByRole('checkbox', { name: '平日の昼' }).check();
  await dialog.getByRole('group', { name: /来たい時間帯/ }).getByRole('checkbox', { name: '土日の午後' }).check();
  await dialog.getByRole('group', { name: /興味のあるイベント/ }).getByRole('checkbox', { name: '犬種別の集まり' }).check();
  await dialog.getByRole('radiogroup', { name: /ほかのドッグラン/ }).getByRole('radio', { name: 'いいえ' }).check();
  await dialog.getByRole('radiogroup', { name: /お知らせ/ }).getByRole('radio', { name: 'はい' }).check();
  await dialog.getByRole('button', { name: '保存する' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(adminToast(page, 'おうちの回答を変えました')).toBeVisible();
  await expect(survey).toContainText('平日の昼・土日の午後');
  await expect(survey).toContainText('犬種別の集まり');

  // 操作ログに残る
  await page.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: '操作ログ' }).click();
  await expect(page.getByText('来たい時間帯: 未回答 → 平日の昼・土日の午後').first()).toBeVisible();

  // M-07 ワンちゃんの体重・相性・予防注射
  await openHousehold(page, 'みつまめ', 'ミツマメのおうち');
  await page.getByRole('link', { name: 'ミツマメの情報を見る・変える' }).click();
  await page.getByLabel('体重(kg)').fill('100.5');
  await expect(page.getByText('体重は0.1から100までの数字で入力してください')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存する' })).toBeDisabled();
  await page.getByLabel('体重(kg)').fill('7.4');
  await page.getByRole('radiogroup', { name: 'ほかの犬との相性' }).getByRole('radio', { name: '得意' }).click();
  await page.getByLabel('狂犬病の予防注射(最近の年)').selectOption({ label: '2026年' });
  await page.getByLabel('混合ワクチン(最近の年)').selectOption({ label: '2025年' });
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(adminToast(page, '保存しました')).toBeVisible();
  const history = page.getByRole('list', { name: '変更の履歴' });
  await expect(history).toContainText('体重: 未登録 → 7.4kg');
  await expect(history).toContainText('ほかの犬との相性: 未登録 → 得意');
  await expect(history).toContainText('狂犬病の予防注射: 未登録 → 2026年');
  await expect(page.getByLabel('体重(kg)')).toHaveValue('7.4');

  // おうちの詳細のワンちゃんの行にも出る
  await page.getByRole('navigation', { name: 'いまいる場所' }).getByRole('link', { name: 'ミツマメのおうち' }).click();
  await expect(page.getByRole('list', { name: 'ワンちゃん' })).toContainText('7.4kg');
  await expect(page.getByRole('list', { name: 'ワンちゃん' })).toContainText('ほかの犬: 得意');
});

test('A-10 「いくつでも選ぶ」の質問を作れる。はい・いいえの固定の質問は選択肢を変えられない', async ({ page }) => {
  await adminLogin(page, 'admin');
  await page.getByRole('link', { name: 'アンケート' }).click();
  const add = page.getByRole('region', { name: '質問を追加' });
  await add.getByRole('radiogroup', { name: '答え方' }).getByRole('radio', { name: 'いくつでも選ぶ' }).click();
  const label = `よく使うおやつ${Date.now().toString(36)}`;
  await add.getByLabel('質問の文').fill(label);
  await add.getByLabel('選択肢(1行に1つ)').fill('ジャーキー\nボーロ\nガム');
  await add.getByRole('button', { name: '追加する' }).click();
  const row = page.getByRole('listitem', { name: label });
  await expect(row).toContainText('いくつでも選ぶ(ジャーキー・ボーロ・ガム)');

  // 固定の「来たい時間帯」は複数選択
  await expect(page.getByRole('listitem', { name: '来たい時間帯' })).toContainText('いくつでも選ぶ(平日の昼・平日の夕方・土日の午前・土日の午後)');
  // はい・いいえの質問は、文だけ変えられる
  await page.getByRole('button', { name: 'お知らせをLINEで受け取りますかを変える' }).click();
  const dialog = page.getByRole('dialog', { name: '質問を変える' });
  await expect(dialog).toContainText('選択肢は変えられません');
  await expect(dialog.getByLabel('選択肢(1行に1つ)')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'やめる' }).click();

  // 作った質問は非表示にしておく(ほかのテストで、登録済みのお客さんに出さないため)
  await row.getByRole('button', { name: `${label}を非表示にする` }).click();
  await expect(row.getByText('非表示', { exact: true })).toBeVisible();
});

test('A-01 ダッシュボードに、来たい時間帯・興味のあるイベント・ほかのドッグラン・ワンちゃんの相性の内訳が出る', async ({ page }) => {
  await adminLogin(page, 'admin');
  await page.getByRole('link', { name: 'ダッシュボード' }).click();
  for (const title of ['来たい時間帯', '興味のあるイベント', 'ほかのドッグランの利用', 'ほかの犬との相性']) {
    await expect(page.getByRole('region', { name: title })).toBeVisible();
  }
});
