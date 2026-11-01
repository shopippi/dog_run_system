import { expect, test } from '@playwright/test';
import { adminLogin, adminToast } from './helpers';

// A-16 使い方と「困ったとき」(M-16)

test.use({ actionTimeout: 10_000 });

test('A-16 管理者が入れた製作者の連絡先が、受付スタッフの「困ったとき」に出る。よくある質問を開ける', async ({ browser }) => {
  const admin = await browser.newPage();
  await adminLogin(admin, 'admin', '/settings');
  const section = admin.getByRole('region', { name: '製作者の連絡先' });
  await section.getByLabel('連絡先').fill('山田(製作者)\n090-0000-0000 平日10時〜18時');
  await section.getByRole('button', { name: '保存する' }).click();
  await expect(adminToast(admin, '保存しました。')).toBeVisible();

  const staff = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await adminLogin(staff, 'staff');
    await staff.getByRole('link', { name: '使い方・困ったとき' }).click();
    await expect(staff.getByLabel('製作者の連絡先')).toHaveText('山田(製作者)\n090-0000-0000 平日10時〜18時');

    const faq = staff.locator('details', { hasText: 'ポイントが付かない' });
    await faq.locator('summary').click();
    await expect(faq.getByText('ポイントはおうちごとに1日1ポイントです。', { exact: false })).toBeVisible();

    // 受付スタッフには、管理者だけの画面の使い方と質問を出さない
    await expect(staff.getByRole('article', { name: '今日の来場' })).toBeVisible();
    await expect(staff.getByRole('article', { name: 'スタッフ' })).toHaveCount(0);
    await expect(staff.getByText('間違えて変えてしまった。元に戻したい')).toHaveCount(0);

    // 管理者には出る
    await admin.goto('/admin/help');
    await expect(admin.getByRole('article', { name: 'スタッフ' })).toBeVisible();
    await expect(admin.getByText('間違えて変えてしまった。元に戻したい')).toBeVisible();
  } finally {
    const res = await admin.request.patch('/admin/api/settings', { headers: { 'x-dr-admin': '1' }, data: { developer_contact: '' } });
    expect(res.status()).toBe(200);
  }
  await staff.close();
  await admin.close();
});
