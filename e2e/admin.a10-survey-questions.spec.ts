import { expect, test } from '@playwright/test';
import { adminLogin, newLineUser, openLiff, registerViaUi } from './helpers';

// A-10 アンケートの管理(M-11)
// データベースはほかのテストと共有するため、追加した質問はテストの最後に非表示にする
// (表示したままだと、ほかのテストのお客さんにもアンケートが出てしまう)。

test('A-10 管理者が追加した質問が、登録済みのお客さんに1回だけ出て、答えると集計に出る', async ({ browser }) => {
  const customer = await browser.newPage();
  const user = newLineUser('パパ');
  await registerViaUi(customer, user, ['クウ']);

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await adminLogin(page, 'admin', '/survey-questions');
  const label = `ほかのドッグランも使っていますか${Date.now().toString(36).slice(-3)}`;
  const add = page.getByRole('region', { name: '質問を追加' });
  await add.getByRole('radio', { name: '家族一人ひとり' }).click();
  await add.getByRole('radio', { name: '選ぶ', exact: true }).click();
  await add.getByLabel('質問の文').fill(label);
  await add.getByLabel('選択肢(1行に1つ)').fill('よく使う\nときどき使う\n使わない');
  await add.getByRole('button', { name: '追加する' }).click();
  const row = page.getByRole('list', { name: '質問' }).getByRole('listitem', { name: label });
  try {
    await expect(row).toContainText('選ぶ(よく使う・ときどき使う・使わない)');
    await expect(row).toContainText('回答 0件');

    // お客さんが次に開くと、1回だけ出る
    await openLiff(customer, user);
    await expect(customer.getByRole('heading', { name: 'アンケートにご協力ください' })).toBeVisible();
    await customer.getByRole('radiogroup', { name: new RegExp(label) }).getByRole('radio', { name: 'ときどき使う' }).check();
    await customer.getByRole('button', { name: '回答する' }).click();
    await customer.getByRole('region', { name: '会員証' }).waitFor();
    await openLiff(customer, user);
    await customer.getByRole('region', { name: '会員証' }).waitFor();
    await expect(customer.getByRole('heading', { name: 'アンケートにご協力ください' })).toHaveCount(0);

    // 集計
    await page.reload();
    await expect(row).toContainText('回答 1件');
    await row.getByRole('button', { name: `${label}の集計` }).click();
    const dialog = page.getByRole('dialog', { name: '回答の集計' });
    await expect(dialog.getByRole('listitem', { name: 'ときどき使う 1件' })).toBeVisible();
    await expect(dialog.getByRole('listitem', { name: 'よく使う 0件' })).toBeVisible();
    await dialog.getByRole('button', { name: '閉じる' }).click();

    // 固定の質問は非表示にできない(ボタンがない)
    const fixed = page.getByRole('list', { name: '質問' }).getByRole('listitem', { name: '年代' });
    await expect(fixed.getByText('固定')).toBeVisible();
    await expect(fixed.getByRole('button', { name: /非表示/ })).toHaveCount(0);
  } finally {
    await row.getByRole('button', { name: `${label}を非表示にする` }).click();
    await expect(row.getByText('非表示', { exact: true })).toBeVisible();
  }
  await customer.close();
  await page.close();
});

test('A-10 固定の質問の文を変えると、登録のアンケートに出る(テストの後で元に戻す)', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await adminLogin(page, 'admin', '/survey-questions');
  const row = page.getByRole('list', { name: '質問' }).getByRole('listitem', { name: 'ふだんの来場手段' });
  await row.getByRole('button', { name: 'ふだんの来場手段を変える' }).click();
  const dialog = page.getByRole('dialog', { name: '質問を変える' });
  await expect(dialog).toContainText('文と選択肢だけ変えられます');
  await expect(dialog.getByRole('radiogroup')).toHaveCount(0);
  await dialog.getByLabel('質問の文').fill('ふだん何で来ますか');
  await dialog.getByRole('button', { name: '保存する' }).click();
  await expect(dialog).toHaveCount(0);
  const changed = page.getByRole('list', { name: '質問' }).getByRole('listitem', { name: 'ふだん何で来ますか' });
  try {
    await expect(changed).toBeVisible();
    const customer = await browser.newPage();
    await openLiff(customer, newLineUser('ママ'));
    await customer.getByLabel('利用規約とプライバシーポリシーに同意します').check();
    await customer.getByRole('button', { name: '同意して次へ' }).click();
    const form = customer.locator('fieldset.dog-form').first();
    await form.getByLabel('名前').fill('モモ');
    await form.getByRole('combobox', { name: /犬種/ }).selectOption({ label: 'プードル' });
    await customer.getByRole('button', { name: '次へ' }).click();
    await expect(customer.getByRole('radiogroup', { name: /ふだん何で来ますか/ })).toBeVisible();
    await customer.close();
  } finally {
    await changed.getByRole('button', { name: 'ふだん何で来ますかを変える' }).click();
    await dialog.getByLabel('質問の文').fill('ふだんの来場手段');
    await dialog.getByRole('button', { name: '保存する' }).click();
    await expect(page.getByRole('list', { name: '質問' }).getByRole('listitem', { name: 'ふだんの来場手段' })).toBeVisible();
  }
  await page.close();
});
