import { expect, test } from '@playwright/test';
import { newLineUser, openCheckin, registerViaUi } from './helpers';

test('C-05 完了画面に、犬の名前・会員ID・ポイント・動く時計が出る', async ({ page }) => {
  const user = newLineUser('ママ');
  const memberNo = await registerViaUi(page, user, ['アル', 'ニコ']);
  await openCheckin(page, user);
  await page.getByRole('button', { name: 'チェックインする' }).click();

  const done = page.getByRole('region', { name: 'チェックイン完了' });
  await expect(done).toBeVisible();
  await expect(done.getByText('アル・ニコ')).toBeVisible();
  await expect(done.getByText(memberNo)).toBeVisible();
  await expect(done.getByText('+1ポイント')).toBeVisible();
  await expect(done.getByText('2頭')).toBeVisible();

  // 時計が動いている(スクリーンショットと見分けるため)
  const clock = done.getByLabel('現在時刻');
  const t1 = await clock.textContent();
  await expect(clock).not.toHaveText(t1!, { timeout: 3000 });
  // 背景が動いている
  const animation = await done.evaluate((el) => getComputedStyle(el, '::before').animationName);
  expect(animation).toBe('done-slide');
});
