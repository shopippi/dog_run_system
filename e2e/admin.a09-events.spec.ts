import { expect, test } from '@playwright/test';
import { adminLogin } from './helpers';

// A-09 イベント・休業日(M-10)

function nextMonth() {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 15));
  return { label: `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月`, day: `${d.getUTCMonth() + 1}月15日` };
}

test('A-09 次の月の日にイベントと臨時休業を登録し、カレンダーに出る。消すと消える', async ({ page }) => {
  await adminLogin(page, 'admin', '/events');
  const cal = page.getByRole('region', { name: 'カレンダー' });
  await cal.getByRole('button', { name: '次の月' }).click();
  const m = nextMonth();
  await expect(cal.getByRole('heading', { name: m.label })).toBeVisible();
  const cell = cal.getByRole('button', { name: new RegExp(`^${m.day}`) });
  await cell.click();
  await expect(cell).toHaveAttribute('aria-pressed', 'true');

  const day = page.getByRole('region', { name: new RegExp(m.day) });
  const form = day.getByRole('form', { name: 'イベントを追加' });
  await form.getByLabel('イベントの名前').fill('しつけ教室');
  await form.getByRole('radio', { name: '教室・講習' }).click();
  await form.getByLabel('メモ').fill('10時から');
  await form.getByRole('button', { name: 'イベントを追加' }).click();
  const ev = day.getByRole('list', { name: 'この日のイベント' }).getByRole('listitem', { name: 'しつけ教室' });
  await expect(ev).toContainText('教室・講習 · 10時から');
  await expect(cell).toContainText('しつけ教室');
  await expect(cell).toHaveAccessibleName(/イベント1件/);

  await day.getByLabel('休業の理由(なくてもよい)').fill('芝の張り替え');
  await day.getByRole('button', { name: '臨時休業にする' }).click();
  await expect(day.getByText('芝の張り替え')).toBeVisible();
  await expect(cell).toHaveAccessibleName(/臨時休業/);

  // 読み込み直しても残る
  await page.reload();
  await cal.getByRole('button', { name: '次の月' }).click();
  await cal.getByRole('button', { name: new RegExp(`^${m.day}`) }).click();
  await expect(cell).toContainText('しつけ教室');

  await ev.getByRole('button', { name: 'しつけ教室を消す' }).click();
  await expect(day.getByText('この日のイベントはありません。')).toBeVisible();
  await day.getByRole('button', { name: '休業をやめる' }).click();
  await expect(day.getByRole('button', { name: '臨時休業にする' })).toBeVisible();
  await expect(cell).not.toHaveAccessibleName(/臨時休業|イベント/);
});

test('A-09 製作者は見るだけ(登録の欄がない)', async ({ page }) => {
  await adminLogin(page, 'developer', '/events');
  await expect(page.getByRole('region', { name: 'カレンダー' })).toBeVisible();
  await expect(page.getByRole('button', { name: '臨時休業にする' })).toHaveCount(0);
  await expect(page.getByRole('form', { name: 'イベントを追加' })).toHaveCount(0);
});
