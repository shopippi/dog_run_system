import { expect, test } from '@playwright/test';
import { authHeaders, checkinOn } from './customer-helpers';
import { newLineUser, openLiff, registerViaUi } from './helpers';
import { liffShot } from './liff-shot';
import { checkinToday, earnPoints } from './tickets-helpers';

// 犬を飼っている人の気持ちに寄り添う小さな記念(docs/design.md 13章)。
// 今日のスタンプは朱肉の色・誕生月・来場の節目・ワンちゃんごとの記録・ワンちゃんが主役の並び。

const shot = async (page: import('@playwright/test').Page, name: string) => {
  if (process.env.SHOT_DIR) await liffShot(page, `${process.env.SHOT_DIR}/iPhone 13/${name}.png`);
};

/** 日本時間の今日 */
const jstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

test('今日の来場で付いたスタンプは朱肉の色で押され、下に小さく「今日のスタンプ」の印が出る', async ({ page, request }) => {
  const user = newLineUser('ママ');
  await registerViaUi(page, user, ['こむぎ']);
  await earnPoints(request, user, 2);
  await openLiff(page, user);
  const panel = page.getByRole('region', { name: 'スタンプ' });
  await expect(panel.locator('.paw.on')).toHaveCount(2);
  await expect(panel.locator('.paw.today')).toHaveCount(0);
  await expect(panel.getByText('今日のスタンプ')).toHaveCount(0);

  await checkinToday(request, user);
  await page.reload();
  await expect(panel.locator('.paw.on')).toHaveCount(3);
  await expect(panel.locator('.paw.today')).toHaveCount(1);
  await expect(panel.locator('.paw').nth(2)).toHaveAttribute('data-today', '');
  // 朱肉の色(緑ではない)。ほかのスタンプは墨のまま
  await expect(panel.locator('.paw.today')).toHaveCSS('fill', 'rgb(180, 83, 42)');
  await expect(panel.locator('.paw.on').first()).not.toHaveCSS('fill', 'rgb(180, 83, 42)');
  await expect(panel.getByText('今日のスタンプ')).toBeVisible();
  // 読み上げは変わらない
  await expect(panel.getByRole('img', { name: 'ポイント 3 / 10' })).toBeVisible();
  await shot(page, 'L-07 今日のスタンプ');
});

test('会員証は、ワンちゃんの顔が先(上段)で、誕生月の子がいれば小さく「○月は○○の誕生月です」', async ({ page, request }) => {
  const user = newLineUser('パパ');
  await registerViaUi(page, user, ['こむぎ', 'だいず']);
  const headers = authHeaders(user);
  const dogs = ((await (await request.get('/api/dogs', { headers })).json()) as { dogs: { id: number; name: string }[] }).dogs;
  const today = jstToday();
  const komugi = dogs.find((d) => d.name === 'こむぎ')!;
  const res = await request.patch(`/api/dogs/${komugi.id}`, { headers, data: { birthYm: `2021-${today.slice(5, 7)}` } });
  expect(res.status(), await res.text()).toBe(200);

  await openLiff(page, user);
  const card = page.getByRole('region', { name: '会員証' });
  await expect(card.getByText(`${Number(today.slice(5, 7))}月はこむぎの誕生月です`)).toBeVisible();
  // 犬の顔(44px)が、おうちの呼び名より上にある
  const dogsBox = (await card.locator('.mc-dogs').boundingBox())!;
  const nameBox = (await card.locator('.mc-name').boundingBox())!;
  expect(dogsBox.y + dogsBox.height).toBeLessThanOrEqual(nameBox.y + 1);
  await expect(card.locator('.mc-dogs .av').first()).toHaveAttribute('width', '44');
  // メニューの「ワンちゃん」の行の右に、その子たちの顔(読み上げは「ワンちゃん」のまま)
  const menuRow = page.getByRole('link', { name: 'ワンちゃん', exact: true });
  await expect(menuRow.locator('.menu-faces .av')).toHaveCount(2);
  // 会員証・メニューに「おやすみ」への導線を出さない
  await expect(page.locator('main')).not.toContainText('おやすみ');
  await shot(page, 'L-07 誕生月');
});

test('来場の節目(10回目)には、チェックイン完了の画面に「○○ちゃんと 10回目の来場です」', async ({ page, request }) => {
  const user = newLineUser('ばあば');
  await registerViaUi(page, user, ['あずき']);
  await earnPoints(request, user, 8);
  const ninth = await checkinOn(request, user, '2026-09-20');
  await openLiff(page, user, `/checkin/done/${ninth}`);
  await page.getByText('9月20日').first().waitFor();
  await expect(page.getByText(/回目の来場です/)).toHaveCount(0);

  const tenth = await checkinToday(request, user);
  await openLiff(page, user, `/checkin/done/${tenth}`);
  await expect(page.getByText('あずきちゃんと 10回目の来場です')).toBeVisible();
  await shot(page, 'L-06 10回目の来場');
});

test('ワンちゃんの変更画面: 上に大きな写真と「写真を変える」、その子の来場の記録。おやすみは帯より下に小さく', async ({ page, request }) => {
  const user = newLineUser('ママ');
  await registerViaUi(page, user, ['もも']);
  await checkinOn(request, user, '2026-09-01');
  await checkinOn(request, user, '2026-09-03');
  await openLiff(page, user, '/dogs');
  // 一覧の写真は 64px
  const row = page.getByRole('link', { name: /もも/ });
  await expect(row.locator('.av')).toHaveAttribute('width', '64');
  await row.click();
  // 写真がない子は、大きな頭文字の絵(幅いっぱい、4:3)
  const hero = page.locator('.dog-hero');
  await expect(hero).toBeVisible();
  const box = (await hero.boundingBox())!;
  const main = (await page.locator('main').boundingBox())!;
  expect(box.width).toBeGreaterThan(main.width - 48);
  expect(box.width / box.height).toBeCloseTo(4 / 3, 1);
  await expect(page.locator('.photo-hero').getByText('写真を撮る・選ぶ')).toBeVisible();
  await expect(page.getByText('一緒に来た回数 2回・最後に来た日 9月3日')).toBeVisible();
  await shot(page, 'L-09 ワンちゃんの変更(大きな写真)');
});
