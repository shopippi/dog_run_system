import { expect, test } from '@playwright/test';
import { adminLogin, newLineUser, openCheckin, openLiff, registerViaUi } from './helpers';
import { checkinToday, earnPoints } from './tickets-helpers';

test('C-06 10ポイントたまると会員証に「無料券と交換する」が出て、確認してから交換できる。足りないときは出ない', async ({ page, request }) => {
  const user = newLineUser('ママ');
  await registerViaUi(page, user, ['ゴンタ']);
  await openLiff(page, user);
  // ポイントの数と「あと○ポイント」は、会員証の下のスタンプのパネルに出る
  const card = page.getByRole('region', { name: 'スタンプ' });
  await expect(card.getByText('あと10ポイントで無料券と交換できます')).toBeVisible();
  await expect(page.getByRole('button', { name: /無料券と交換する/ })).toHaveCount(0);

  await earnPoints(request, user, 11);
  await openLiff(page, user);
  await expect(card.getByText('無料券と交換できます')).toBeVisible();
  await expect(card.getByRole('img', { name: 'ポイント 10 / 10' })).toBeVisible();
  // 交換のボタンが主ボタン。チェックインのボタンは副ボタンになる
  await expect(page.getByRole('button', { name: 'チェックイン(受付のQRを読む)' })).toHaveClass(/sub/);
  await page.getByRole('button', { name: '無料券と交換する(10ポイント)' }).click();
  const confirm = page.getByRole('group', { name: '無料券との交換の確認' });
  await expect(confirm).toContainText('10ポイントを無料券1枚と交換します。');
  await expect(confirm).toContainText('いま11ポイント → 交換したあと1ポイント');
  await confirm.getByRole('button', { name: 'やめる' }).click();
  await expect(confirm).toHaveCount(0);

  await page.getByRole('button', { name: '無料券と交換する(10ポイント)' }).click();
  await page.getByRole('group', { name: '無料券との交換の確認' }).getByRole('button', { name: '交換する' }).click();
  await expect(page.getByRole('status')).toHaveText('無料券と交換しました。');
  const tickets = page.getByRole('list', { name: '未使用の無料券' });
  await expect(tickets.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByText('未使用 1枚')).toBeVisible();
  await expect(card.getByText('あと9ポイントで無料券と交換できます')).toBeVisible();
  await expect(page.getByRole('button', { name: /無料券と交換する/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'チェックイン(受付のQRを読む)' })).not.toHaveClass(/sub/);

  // チェックインの画面には「無料券を使う」の選択はない
  await openCheckin(page, user);
  await expect(page.getByRole('button', { name: 'チェックインする' })).toBeVisible();
  await expect(page.getByText('無料券を使う')).toHaveCount(0);
});

test('C-06 無料券の「使用する」を確認して押すと「無料券を使用しました」の画面が出て、受付の今日の来場に印が付く', async ({ browser, page, request }) => {
  test.setTimeout(90_000);
  const user = newLineUser('パパ');
  const memberNo = await registerViaUi(page, user, ['ハチ']);
  await earnPoints(request, user, 10);
  await openLiff(page, user);
  await page.getByRole('button', { name: '無料券と交換する(10ポイント)' }).click();
  await page.getByRole('group', { name: '無料券との交換の確認' }).getByRole('button', { name: '交換する' }).click();
  await checkinToday(request, user);
  await openLiff(page, user);

  const row = page.getByRole('list', { name: '未使用の無料券' }).getByRole('listitem').first();
  await row.getByRole('button', { name: '使用する' }).click();
  const confirm = page.getByRole('group', { name: '無料券の使用の確認' });
  await expect(confirm).toContainText('受付で見せながら押してください。使用すると元に戻せません。');
  await confirm.getByRole('button', { name: '使用する' }).click();

  await expect(page).toHaveURL(/\/liff\/tickets\/\d+$/);
  const done = page.getByRole('region', { name: '無料券を使用しました' });
  await expect(done.getByText('無料券を使用しました')).toBeVisible();
  await expect(done.getByText('ハチのおうち')).toBeVisible();
  await expect(done.getByText(memberNo)).toBeVisible();
  // 時計は動いている(スクリーンショットと見分ける)
  const clock = done.getByRole('timer', { name: '現在時刻' });
  const first = await clock.textContent();
  await expect.poll(async () => clock.textContent(), { timeout: 5000 }).not.toBe(first);
  await expect(page.getByText('のこりの無料券')).toBeVisible();

  // 会員証に戻ると、今日使った券の画面をもう一度開ける
  await page.getByRole('link', { name: '会員証にもどる' }).click();
  await expect(page.getByText('未使用 0枚')).toBeVisible();
  await page.getByRole('link', { name: '今日使った無料券の画面を見る' }).click();
  await expect(page.getByRole('region', { name: '無料券を使用しました' })).toBeVisible();

  // 受付の「今日の来場」に「無料券を使用」の印
  const admin = await browser.newPage();
  await adminLogin(admin, 'staff');
  const visit = admin.getByRole('listitem', { name: /ハチ/ }).first();
  await expect(visit.getByText('無料券を使用')).toBeVisible();
  await admin.close();
});
