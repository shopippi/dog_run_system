import { expect, test } from '@playwright/test';
import { adminLogin } from './helpers';

// A-13 スタッフの管理(M-14)
// e2e/start-server.sh で作ったアカウント(admin・staff・developer)は、ほかのテストが使うので停止しない。

test('A-13 受付スタッフを追加し、停止するとログインできなくなり、再開すると戻る', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await adminLogin(page, 'admin', '/staff');
  const email = `taro-${Date.now().toString(36)}@example.com`;
  const add = page.getByRole('region', { name: 'スタッフを追加' });
  await add.getByLabel('名前').fill('受付たろう');
  await add.getByLabel('メールアドレス').fill(email);
  await add.getByRole('radio', { name: '受付スタッフ' }).click();
  await add.getByLabel('はじめのパスワード').fill('short');
  await add.getByRole('button', { name: '追加する' }).click();
  await expect(add.getByRole('alert')).toContainText('パスワードは10文字以上にしてください。');
  await add.getByLabel('はじめのパスワード').fill('taro-password-1');
  await add.getByRole('button', { name: '追加する' }).click();
  const row = page.getByRole('list', { name: 'スタッフ' }).getByRole('listitem', { name: '受付たろう' }).last();
  await expect(row).toContainText(email);
  await expect(row).toContainText('まだログインしていません');

  // 追加したスタッフがログインしている間に停止する
  const other = await browser.newPage();
  await other.goto('/admin/');
  await other.getByLabel('メールアドレス').fill(email);
  await other.getByLabel('パスワード').fill('taro-password-1');
  await other.getByRole('button', { name: 'ログイン' }).click();
  await other.getByRole('button', { name: 'ログアウト' }).waitFor();

  await row.getByRole('button', { name: '受付たろうさんを停止する' }).click();
  const dialog = page.getByRole('dialog', { name: 'アカウントを停止する' });
  await expect(dialog.getByRole('button', { name: 'やめる' })).toBeFocused();
  await dialog.getByRole('button', { name: '停止する' }).click();
  await expect(row.getByText('停止中')).toBeVisible();

  // ログイン中の画面も使えなくなる
  await other.reload();
  await expect(other.getByRole('button', { name: 'ログイン' })).toBeVisible();
  await other.getByLabel('メールアドレス').fill(email);
  await other.getByLabel('パスワード').fill('taro-password-1');
  await other.getByRole('button', { name: 'ログイン' }).click();
  await expect(other.getByRole('alert')).toContainText('このアカウントは停止されています');

  await row.getByRole('button', { name: '受付たろうさんを再開する' }).click();
  await expect(row.getByText('停止中')).toHaveCount(0);
  await other.getByRole('button', { name: 'ログイン' }).click();
  await other.getByRole('button', { name: 'ログアウト' }).waitFor();
  await other.close();
  await page.close();
});

test('A-13 パスワードを再発行すると、新しいパスワードが1回だけ表示され、それでログインできる', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await adminLogin(page, 'admin', '/staff');
  const email = `hanako-${Date.now().toString(36)}@example.com`;
  const add = page.getByRole('region', { name: 'スタッフを追加' });
  await add.getByLabel('名前').fill('受付はなこ');
  await add.getByLabel('メールアドレス').fill(email);
  await add.getByLabel('はじめのパスワード').fill('hanako-password-1');
  await add.getByRole('button', { name: '追加する' }).click();
  const row = page.getByRole('list', { name: 'スタッフ' }).getByRole('listitem', { name: '受付はなこ' }).last();
  await row.getByRole('button', { name: '受付はなこさんのパスワードを再発行' }).click();
  const dialog = page.getByRole('dialog', { name: 'パスワードを再発行' });
  await expect(dialog.getByRole('radio', { name: 'ランダムに作る' })).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('button', { name: '再発行する' }).click();
  const done = page.getByRole('dialog', { name: 'パスワードを再発行しました' });
  const password = (await done.getByLabel('新しいパスワード').textContent())!.trim();
  expect(password).toMatch(/^[a-zA-Z2-9]{12}$/);
  await done.getByRole('button', { name: '閉じる' }).click();
  await expect(page.getByText(password)).toHaveCount(0);

  const other = await browser.newPage();
  await other.goto('/admin/');
  await other.getByLabel('メールアドレス').fill(email);
  await other.getByLabel('パスワード').fill(password);
  await other.getByRole('button', { name: 'ログイン' }).click();
  await other.getByRole('button', { name: 'ログアウト' }).waitFor();
  // 受付スタッフにはスタッフの画面がない
  await expect(other.getByRole('link', { name: 'スタッフ' })).toHaveCount(0);
  await other.close();
  await page.close();
});

test('A-13 自分は停止できず、製作者は一覧を見るだけ', async ({ browser }) => {
  const page = await browser.newPage();
  await adminLogin(page, 'admin', '/staff');
  const me = page.getByRole('list', { name: 'スタッフ' }).getByRole('listitem', { name: '管理者' }).first();
  await expect(me).toContainText('(あなた)');
  await expect(me.getByRole('button', { name: /停止する/ })).toHaveCount(0);
  const dev = page.getByRole('list', { name: 'スタッフ' }).getByRole('listitem', { name: '製作者' });
  await expect(dev.getByRole('button', { name: /パスワード/ })).toHaveCount(0);
  await page.close();

  const devPage = await browser.newPage();
  await adminLogin(devPage, 'developer', '/staff');
  await expect(devPage.getByRole('list', { name: 'スタッフ' }).getByRole('listitem').first()).toBeVisible();
  await expect(devPage.getByRole('region', { name: 'スタッフを追加' })).toHaveCount(0);
  await expect(devPage.getByRole('button', { name: /停止する|再発行/ })).toHaveCount(0);
  await devPage.close();
});
