import { expect, test } from '@playwright/test';
import { adminLogin, adminToast } from './helpers';

// A-17・D-02 システムの状態(M-17)の通し操作
test.describe('A-17 システムの状態', () => {
  test('管理者は処理ごとの色を見て、「今すぐ実行」で集計とバックアップを動かせる', async ({ page }) => {
    await adminLogin(page, 'admin', '/status');
    const list = page.getByRole('region', { name: '自動で動く処理' });
    const stats = list.getByRole('listitem', { name: /日別の集計/ });
    await expect(stats).toBeVisible();
    await stats.getByRole('button', { name: '今すぐ実行' }).click();
    await expect(adminToast(page, '日別の集計を作り直しました')).toBeVisible();
    await expect(list.getByRole('listitem', { name: '日別の集計 正常' })).toBeVisible();

    const backup = list.getByRole('listitem', { name: /バックアップ/ });
    await backup.getByRole('button', { name: '今すぐ実行' }).click();
    await expect(adminToast(page, '個の表')).toBeVisible();
    await expect(list.getByRole('listitem', { name: 'バックアップ 正常' })).toBeVisible();
    // 管理者には詳細(記録の件数)は出さない
    await expect(page.getByRole('region', { name: '記録の件数' })).toHaveCount(0);
  });

  test('製作者は詳細(実行の履歴・記録の件数)を見られるが、「今すぐ実行」は出ない', async ({ page }) => {
    await adminLogin(page, 'developer', '/status');
    await expect(page.getByRole('region', { name: '記録の件数' }).getByText('households')).toBeVisible();
    await expect(page.getByRole('region', { name: '自動処理の実行の履歴' })).toBeVisible();
    // 英語や IT 用語の見出しは出さない
    await expect(page.getByRole('region', { name: 'うまくいかなかった処理' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /データ|エラー/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '今すぐ実行' })).toHaveCount(0);
  });

  test('受付スタッフのメニューには出ず、開いても中身は見られない', async ({ page }) => {
    await adminLogin(page, 'staff');
    await expect(page.getByRole('link', { name: 'システムの状態' })).toHaveCount(0);
    await page.goto('/admin/status');
    await expect(page.getByRole('alert')).toContainText('権限がありません');
  });
});
