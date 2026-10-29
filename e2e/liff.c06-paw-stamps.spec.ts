import { expect, test, type Page } from '@playwright/test';
import { checkinOn } from './customer-helpers';
import { newLineUser, openLiff, registerViaUi } from './helpers';
import { earnPoints } from './tickets-helpers';
import { liffShot } from './liff-shot';

// 担当I: 会員証の下のスタンプ(C-06、docs/design.md 5章「スタンプ」)。
// 肉球のスタンプ(たまった分は ink の塗りで少し傾く。まだの分は輪郭だけ)、10 個目は骨、
// 1 枚分を超えた分は「11個目から」の 2 段目、新しく付いた 1 個は開いたときに 1 回だけ押す動き。

async function shot(page: Page, name: string) {
  if (process.env.SHOT_DIR) await liffShot(page, `${process.env.SHOT_DIR}/iPhone 13/${name}.png`);
}

test('C-06 スタンプは肉球で、たまった分は少しずつ傾いて塗られ、10個目は骨。右上に「3 / 10」', async ({ page, request }) => {
  const user = newLineUser('ママ');
  await registerViaUi(page, user, ['ゴンタ']);
  await earnPoints(request, user, 3);
  await openLiff(page, user);
  const panel = page.getByRole('region', { name: 'スタンプ' });
  await expect(panel.getByRole('img', { name: 'ポイント 3 / 10' })).toBeVisible();
  await expect(panel.getByText('3 / 10', { exact: true })).toBeVisible();
  await expect(panel.getByText('あと7ポイントで無料券と交換できます')).toBeVisible();
  await expect(panel.locator('.paw')).toHaveCount(10);
  await expect(panel.locator('.paw.on')).toHaveCount(3);
  await expect(panel.locator('.paw.bone')).toHaveCount(1);
  await expect(panel.locator('.paw').nth(9)).toHaveClass(/bone/);
  // 傾きは位置ごとに決まっていて、ばらばら(−6〜+6 度)
  const tilts = await panel.locator('.paw.on').evaluateAll((els) => els.map((el) => getComputedStyle(el).getPropertyValue('--tilt').trim()));
  expect(tilts).toEqual(['-6deg', '1deg', '-5deg']);
  // まだの分は輪郭だけ
  await expect(panel.locator('.paw').nth(5)).toHaveCSS('fill', 'none');
  // 交換はまだできない
  await expect(page.getByRole('button', { name: /無料券と交換する/ })).toHaveCount(0);
  await shot(page, 'L-07 スタンプ(3個)');
});

test('C-06 新しく付いたスタンプだけ、開いたときに1回押す動きが付く。動きを減らす設定では動かさない', async ({ page, request }) => {
  const user = newLineUser('パパ');
  await registerViaUi(page, user, ['アル']);
  await earnPoints(request, user, 2);
  await openLiff(page, user);
  const panel = page.getByRole('region', { name: 'スタンプ' });
  await expect(panel.locator('.paw.on')).toHaveCount(2);
  // 前回から増えていない(登録の直後に覚えた数から増えた分)
  await page.reload();
  await expect(panel.locator('.paw.on')).toHaveCount(2);
  await expect(panel.locator('.paw.fresh')).toHaveCount(0);

  await checkinOn(request, user, '2026-09-20');
  await page.reload();
  await expect(panel.locator('.paw.on')).toHaveCount(3);
  await expect(panel.locator('.paw.fresh')).toHaveCount(1);
  await expect(panel.locator('.paw').nth(2)).toHaveClass(/fresh/);
  await expect(panel.locator('.paw.fresh')).toHaveCSS('animation-name', 'paw-press');
  await expect(panel.locator('.paw.fresh')).toHaveCSS('animation-duration', '0.25s');
  // もう一度開いても動かない
  await page.reload();
  await expect(panel.locator('.paw.on')).toHaveCount(3);
  await expect(panel.locator('.paw.fresh')).toHaveCount(0);

  // 動きを減らす設定
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await checkinOn(request, user, '2026-09-21');
  await page.reload();
  await expect(panel.locator('.paw.fresh')).toHaveCount(1);
  await expect(panel.locator('.paw.fresh')).toHaveCSS('animation-name', 'none');
});

test('C-06 1枚分を超えた分は「11個目から」の2段目に続き、交換のボタンはスタンプのパネルの中の主ボタン', async ({ page, request }) => {
  const user = newLineUser('ばあば');
  await registerViaUi(page, user, ['モモ']);
  await earnPoints(request, user, 12);
  await openLiff(page, user);
  const panel = page.getByRole('region', { name: 'スタンプ' });
  await expect(panel.getByText('12 / 10', { exact: true })).toBeVisible();
  await expect(panel.getByRole('img', { name: 'ポイント 10 / 10' })).toBeVisible();
  await expect(panel.getByText('11個目から')).toBeVisible();
  await expect(panel.getByRole('img', { name: '11個目から 2 / 10' })).toBeVisible();
  await expect(panel.locator('.paw')).toHaveCount(20);
  await expect(panel.locator('.paw.on')).toHaveCount(12);
  await expect(panel.locator('.paw.bone.on')).toHaveCount(1);
  await expect(panel.getByText('無料券と交換できます', { exact: true })).toBeVisible();
  // 主ボタンは交換。チェックインは副ボタンになる(主ボタンは1画面に1つ)
  const exchange = panel.getByRole('button', { name: '無料券と交換する(10ポイント)' });
  await expect(exchange).toHaveClass(/^btn$/);
  await expect(page.getByRole('button', { name: 'チェックイン(受付のQRを読む)' })).toHaveClass(/sub/);
  // 無料券のパネルは 0 枚の一文
  await expect(page.getByText('使える無料券はありません')).toBeVisible();
  await shot(page, 'L-07 スタンプ(12個・交換できる)');

  // 会員証の並び: 会員証 → チェックイン → スタンプ → 無料券 → メニュー
  const order = await page.evaluate(() => {
    const y = (sel: string) => document.querySelector(sel)!.getBoundingClientRect().top;
    return [y('.member-card'), y('main > .btn'), y('.stamp-panel'), y('.tk-section'), y('nav.menu')];
  });
  expect([...order].sort((a, b) => a - b)).toEqual(order);

  await exchange.click();
  await page.getByRole('dialog', { name: '無料券と交換します' }).getByRole('button', { name: '交換する' }).click();
  await expect(page.getByRole('status')).toHaveText('無料券と交換しました。');
  await expect(panel.getByText('2 / 10', { exact: true })).toBeVisible();
  await expect(panel.getByText('11個目から')).toHaveCount(0);
  await expect(page.getByRole('list', { name: '未使用の無料券' }).getByRole('listitem')).toHaveCount(1);
});
