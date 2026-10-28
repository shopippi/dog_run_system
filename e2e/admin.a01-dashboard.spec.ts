import { expect, test } from '@playwright/test';
import { d1, daysAgo, householdIdOf } from './analytics-helpers';
import { adminLogin, newLineUser, openCheckin, registerViaUi } from './helpers';

// A-01 ダッシュボード(M-05)の通し操作
test.describe('A-01 ダッシュボード', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const page = await browser.newPage();
    // 今日来たおうち(画面からチェックイン)
    const a = newLineUser('パパ');
    await registerViaUi(page, a, ['ダイズ']);
    await openCheckin(page, a);
    await page.getByRole('button', { name: 'チェックインする' }).click();
    await page.getByRole('region', { name: 'チェックイン完了' }).waitFor();
    // しばらく来ていない常連さん(画面からは古い来場を作れないので、データベースに直接入れる)
    const memberNo = await registerViaUi(page, newLineUser('ママ'), ['クルミ']);
    const h = householdIdOf(memberNo.trim());
    const values = [200, 150, 120].map((n) => `(${h}, '${daysAgo(n)}', '${daysAgo(n)}T10:00:00+09:00', 1, 'self')`).join(', ');
    d1(`INSERT INTO visits (household_id, visit_date, checked_in_at, dog_count, method) VALUES ${values}`);
    await page.close();
  });

  test('管理者は、数値・推移・構成のグラフと、しばらく来ていない常連さんを見られる', async ({ page }) => {
    await adminLogin(page, 'admin', '/dashboard');
    await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible();
    const kpis = page.getByRole('region', { name: '期間の集計' });
    await expect(kpis.getByText('来場頭数')).toBeVisible();
    // 今月のチェックインが数に入っている
    await expect(kpis.locator('.kpi', { hasText: '来場頭数' }).locator('.v')).not.toHaveText(/^0頭$/);
    await expect(page.getByRole('region', { name: '来場の推移' }).locator('canvas')).toBeVisible();
    await expect(page.getByRole('region', { name: '犬種' }).locator('canvas')).toHaveAttribute('aria-label', /プードル/);

    // 期間を切り替える
    await page.getByRole('radiogroup', { name: '期間' }).getByRole('radio', { name: '過去12か月' }).check();
    await expect(page.getByRole('status').filter({ hasText: '〜' })).not.toContainText('読み込んでいます');
    const dormant = page.getByRole('list', { name: 'しばらく来ていない常連さん' });
    await expect(dormant.getByText('クルミ', { exact: true })).toBeVisible();
    await expect(dormant.getByText(/3回来場/).first()).toBeVisible();
    // 押すと、おうちの詳細に進む
    await dormant.getByRole('link', { name: /クルミ/ }).click();
    await expect(page).toHaveURL(/\/admin\/households\/\d+$/);
  });

  test('期間を選ぶと、始まりと終わりの日付を入れられる', async ({ page }) => {
    await adminLogin(page, 'admin', '/dashboard');
    await page.getByRole('radiogroup', { name: '期間' }).getByRole('radio', { name: '期間を選ぶ' }).check();
    const fromInput = page.getByLabel('始まり');
    await expect(fromInput).toBeVisible();
    await fromInput.fill(daysAgo(6));
    await expect(page.getByRole('region', { name: '来場の推移' })).toBeVisible();
    await expect(page.locator('p[role=status]', { hasText: '〜' })).toContainText('営業日');
  });

  test('受付スタッフには、管理者向けの指標(継続状況・常連さん・家族・追加したアンケート)を出さない', async ({ page }) => {
    await adminLogin(page, 'staff', '/dashboard');
    await expect(page.getByRole('region', { name: '期間の集計' })).toBeVisible();
    await expect(page.getByRole('region', { name: '来場頻度' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'しばらく来ていない常連さん' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'おうちの継続状況' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: '家族での利用' })).toHaveCount(0);
  });
});
