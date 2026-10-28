import { expect, test, type Page } from '@playwright/test';
import { answerSurvey, newLineUser, openLiff } from './helpers';

// C-03 飼い主とワンちゃんの情報の見直し(docs/changes-2026-10-28.md 7章、担当J)

/** 同意して、1頭目の名前と犬種を入れる(ワンちゃんの登録の画面まで) */
async function startRegister(page: Page, user: string, dogName: string) {
  await openLiff(page, user);
  await page.getByLabel('利用規約とプライバシーポリシーに同意します').check();
  await page.getByRole('button', { name: '同意して次へ' }).click();
  const form = page.locator('fieldset.dog-form').first();
  await form.getByLabel('名前').fill(dogName);
  await form.getByRole('combobox', { name: /犬種/ }).selectOption({ label: 'ダックスフンド' });
  return form;
}

test('C-03 新しい項目は全部任意。体重・相性・予防注射と、来たい時間帯などを選ぶだけで答えられる', async ({ page }) => {
  const user = newLineUser('ママ');
  const form = await startRegister(page, user, 'キナコモチ');

  // 体重・相性・予防注射は、たたんだ欄の中(あとでもよい)
  const more = form.locator('details.pf-more');
  await expect(more).not.toHaveAttribute('open', '');
  await more.locator('summary').click();
  await form.getByLabel('体重').fill('5.25');
  await page.getByRole('button', { name: '次へ' }).click();
  await expect(page.getByRole('alert')).toContainText('体重は小数1桁まで');
  await form.getByLabel('体重').fill('５.２');
  await form.getByRole('radiogroup', { name: 'ほかの犬との相性' }).getByRole('radio', { name: '苦手' }).check();
  await form.getByLabel('狂犬病の予防注射').selectOption({ label: '2026年' });
  await page.getByRole('button', { name: '次へ' }).click();

  // アンケート: 必須は年代・性別・きっかけだけ。新しい質問は「よければ教えてください」の欄にまとめる
  await answerSurvey(page);
  const later = page.getByRole('region', { name: 'よければ教えてください' });
  await expect(later).toContainText('あとで、会員証の「プロフィール」からでも答えられます');
  await expect(later.locator('.req', { hasText: '必須' })).toHaveCount(0);
  const times = later.getByRole('group', { name: /来たい時間帯/ });
  await times.getByRole('checkbox', { name: '土日の午前' }).check();
  await times.getByRole('checkbox', { name: '平日の夕方' }).check();
  await later.getByRole('group', { name: /興味のあるイベント/ }).getByRole('checkbox', { name: '写真撮影会' }).check();
  await later.getByRole('radiogroup', { name: /ほかのドッグラン/ }).getByRole('radio', { name: 'はい' }).check();
  await page.getByRole('button', { name: '登録する' }).click();
  await page.getByText('登録が完了しました').waitFor();

  // プロフィールで、答えた内容が選ばれている
  await openLiff(page, user, '/profile');
  const household = page.getByRole('region', { name: 'おうちについて' });
  await expect(household.getByRole('checkbox', { name: '土日の午前' })).toBeChecked();
  await expect(household.getByRole('checkbox', { name: '平日の夕方' })).toBeChecked();
  await expect(household.getByRole('checkbox', { name: '平日の昼' })).not.toBeChecked();
  await expect(household.getByRole('radiogroup', { name: /ほかのドッグラン/ }).getByRole('radio', { name: 'はい' })).toBeChecked();
  // 選び直して保存できる
  await household.getByRole('checkbox', { name: '平日の夕方' }).uncheck();
  await household.getByRole('group', { name: /興味のあるイベント/ }).getByRole('checkbox', { name: 'しつけ教室' }).check();
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(page.getByRole('status')).toContainText('保存しました');
  await page.reload();
  await expect(household.getByRole('checkbox', { name: '平日の夕方' })).not.toBeChecked();
  await expect(household.getByRole('checkbox', { name: 'しつけ教室' })).toBeChecked();

  // ワンちゃんの変更画面: 入れた内容が開いた欄に出て、変えられる
  await openLiff(page, user, '/dogs');
  await page.getByRole('link', { name: /キナコモチ/ }).click();
  const edit = page.locator('fieldset.dog-form');
  await expect(edit.locator('details.pf-more')).toHaveAttribute('open', '');
  await expect(edit.getByLabel('体重')).toHaveValue('5.2');
  await expect(edit.getByRole('radio', { name: '苦手' })).toBeChecked();
  await expect(edit.getByLabel('狂犬病の予防注射')).toHaveValue('2026');
  await edit.getByLabel('体重').fill('5.6');
  await edit.getByRole('radio', { name: 'ふつう' }).check();
  await page.getByRole('button', { name: '保存する' }).click();
  await page.getByRole('link', { name: /キナコモチ/ }).click();
  await expect(page.locator('fieldset.dog-form').getByLabel('体重')).toHaveValue('5.6');
  await expect(page.locator('fieldset.dog-form').getByRole('radio', { name: 'ふつう' })).toBeChecked();
});

test('C-03 新しい任意の質問に答えていない人には、登録のあとのアンケートを出さず、会員証に小さく出す。「あとで答える」で消える', async ({ page }) => {
  const user = newLineUser('パパ');
  await startRegister(page, user, 'ヨモギダンゴ');
  await page.getByRole('button', { name: '次へ' }).click();
  await answerSurvey(page);
  await page.getByRole('button', { name: '登録する' }).click();
  await page.getByText('登録が完了しました').waitFor();

  await openLiff(page, user);
  await page.getByRole('region', { name: '会員証' }).waitFor();
  await expect(page.getByRole('heading', { name: 'アンケートにご協力ください' })).toHaveCount(0);
  const nudge = page.locator('.pf-nudge');
  await expect(nudge).toContainText('来たい時間帯や、興味のあるイベントを教えてください');
  await nudge.getByRole('button', { name: 'あとで答える' }).click();
  await expect(nudge).toHaveCount(0);
  await page.reload();
  await page.getByRole('region', { name: '会員証' }).waitFor();
  await expect(page.locator('.pf-nudge')).toHaveCount(0);

  // 別の端末(保存した「あとで」がない)では出る。「答える」からプロフィールで答えると、もう出ない
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('.pf-nudge').getByRole('link', { name: '答える' }).click();
  await expect(page.getByRole('heading', { name: 'プロフィール' })).toBeVisible();
  await page.getByRole('radiogroup', { name: /お知らせ/ }).getByRole('radio', { name: 'はい' }).check();
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(page.getByRole('status')).toContainText('保存しました');
  await openLiff(page, user);
  await page.getByRole('region', { name: '会員証' }).waitFor();
  await expect(page.locator('.pf-nudge')).toHaveCount(0);
});
