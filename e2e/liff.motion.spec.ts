import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { checkinOn } from './customer-helpers';
import { newLineUser, openLiff, registerViaUi } from './helpers';
import { earnPoints } from './tickets-helpers';

// 動き(docs/design.md 11.6)。会員証を開いたときの「ポポポン」、増えた 1 個の「ポン」、
// 同じ日・同じ数なら 1 日 1 回、動きを減らす設定では動かない、シートを下へ引っ張って閉じる。
// このファイルのテストは、動きを確かめるため「動きを減らす」を外して動かす(初期値は playwright.config.ts で reduce)。

test.use({ reducedMotion: 'no-preference' });

/** 会員証のスタンプの見え方を、画面が描かれるたびに記録する(押された = 不透明度 0.5 より上) */
async function recordStamps(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __stamps: { t: number; n: number; total: number }[] };
    w.__stamps = [];
    const tick = () => {
      const paws = [...document.querySelectorAll<SVGElement>('.paws-grid .paw.on')];
      if (paws.length > 0) {
        const n = paws.filter((el) => {
          const press = el.closest<HTMLElement>('.paw-press');
          return press ? Number(getComputedStyle(press).opacity) > 0.5 : true;
        }).length;
        w.__stamps.push({ t: performance.now(), n, total: paws.length });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
const samples = (page: Page) =>
  page.evaluate(() => (window as unknown as { __stamps: { t: number; n: number; total: number }[] }).__stamps);

const SHOT_DIR = process.env.SHOT_DIR;

test('会員証を開くと、たまったスタンプが左上から順に押されていき、1秒ほどで全部押される', async ({ page, request }) => {
  const user = newLineUser('ママ');
  await registerViaUi(page, user, ['アル']);
  await earnPoints(request, user, 7);
  await recordStamps(page);
  await openLiff(page, user);
  const panel = page.getByRole('region', { name: 'スタンプ' });
  await expect(panel.locator('.paws')).toHaveAttribute('data-stamps', /playing|done/);
  // 動きの間も、読み上げは変わらない
  await expect(panel.getByRole('img', { name: 'ポイント 7 / 10' })).toBeVisible();

  if (SHOT_DIR) {
    // 動きの確認用に、開いた直後から 0.1 秒ごとに写真を撮る
    const dir = path.join(SHOT_DIR, 'frames');
    fs.mkdirSync(dir, { recursive: true });
    const t0 = Date.now();
    for (let i = 0; i < 12; i++) {
      await page.screenshot({ path: path.join(dir, `stamps-${String(i).padStart(2, '0')}-${Date.now() - t0}ms.png`) });
      const wait = (i + 1) * 100 - (Date.now() - t0);
      if (wait > 0) await page.waitForTimeout(wait);
    }
  }

  await expect(panel.locator('.paws')).toHaveAttribute('data-stamps', 'done', { timeout: 3000 });
  const s = await samples(page);
  expect(s.length).toBeGreaterThan(5);
  const total = s[0]!.total;
  expect(total).toBe(7);
  // 最初はまだ押されていない → 途中 → 全部押された。押された数は減らない
  expect(s[0]!.n).toBeLessThan(total);
  expect(s.some((x) => x.n > 0 && x.n < total)).toBe(true);
  expect(s[s.length - 1]!.n).toBe(total);
  for (let i = 1; i < s.length; i++) expect(s[i]!.n).toBeGreaterThanOrEqual(s[i - 1]!.n);
  // 1 つ目が押されてから、全部が押されるまで 1 秒以内
  const first = s.find((x) => x.n > 0)!.t;
  const all = s.find((x) => x.n === total)!.t;
  expect(all - first).toBeLessThanOrEqual(1000);
  // 押し終わった形: 傾きと濃さは、位置ごとに決まった値のまま
  const tilts = await panel.locator('.paw.on').evaluateAll((els) => els.map((el) => getComputedStyle(el).getPropertyValue('--tilt').trim()));
  expect(tilts).toEqual(['-6deg', '1deg', '-5deg', '2deg', '-4deg', '3deg', '-3deg']);
});

test('前回より増えた1個は、ほかより遅れて大きめに「ポン」と押され、インクがにじむ', async ({ page, request }) => {
  const user = newLineUser('パパ');
  await registerViaUi(page, user, ['ニコ']);
  await earnPoints(request, user, 2);
  await openLiff(page, user);
  const panel = page.getByRole('region', { name: 'スタンプ' });
  await expect(panel.locator('.paws')).toHaveAttribute('data-stamps', 'done', { timeout: 3000 });

  await checkinOn(request, user, '2026-09-20');
  await page.reload();
  await expect(panel.locator('[data-pon]')).toHaveCount(1);
  await expect(panel.locator('.paw').nth(2)).toHaveAttribute('data-pon', '');
  // 増えた 1 個にだけ、インクのにじみが付き、ほかより遅れて押す
  await expect(panel.locator('.paw-ink')).toHaveCount(1);
  const delays = await panel.locator('.paw-press').evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-delay'))));
  expect(delays).toHaveLength(3);
  expect(delays[2]).toBeGreaterThan(Math.max(delays[0]!, delays[1]!));
  await expect(panel.locator('.paws')).toHaveAttribute('data-stamps', 'done', { timeout: 3000 });
});

test('同じ日・同じ数で開き直すと、最初から押された形で出る(「ポポポン」は1日1回)', async ({ page, request }) => {
  const user = newLineUser('ばあば');
  await registerViaUi(page, user, ['リク']);
  await earnPoints(request, user, 4);
  await openLiff(page, user);
  const panel = page.getByRole('region', { name: 'スタンプ' });
  await expect(panel.locator('.paws')).toHaveAttribute('data-stamps', 'done', { timeout: 3000 });
  await page.reload();
  await expect(panel.locator('.paw.on')).toHaveCount(4);
  await expect(panel.locator('.paws')).toHaveAttribute('data-stamps', 'still');
  await expect(panel.locator('.paw-press')).toHaveCount(0);
  // 覚えた日付が変わると、また押す(次の日に開いたとき)
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('dr.stamps.played.')) localStorage.setItem(k, `2000-01-01:4`);
  });
  await page.reload();
  await expect(panel.locator('.paws')).toHaveAttribute('data-stamps', /playing|done/);
});

test.describe('動きを減らす設定', () => {
  test.use({ reducedMotion: 'reduce' });
  test('スタンプは動かさず、最初から押された形で出る', async ({ page, request }) => {
    const user = newLineUser('じいじ');
    await registerViaUi(page, user, ['ルル']);
    await earnPoints(request, user, 4);
    await openLiff(page, user);
    const panel = page.getByRole('region', { name: 'スタンプ' });
    await expect(panel.locator('.paw.on')).toHaveCount(4);
    await checkinOn(request, user, '2026-09-20');
    await recordStamps(page);
    await page.reload();
    await expect(panel.locator('.paw.on')).toHaveCount(5);
    await expect(panel.locator('.paws')).toHaveAttribute('data-stamps', 'still');
    await expect(panel.locator('.paw-press')).toHaveCount(0);
    // 増えた 1 個の印は付くが、にじみの動きは付けない
    await expect(panel.locator('[data-pon]')).toHaveCount(1);
    await expect(panel.locator('.paw-ink')).toHaveCount(0);
    // 最初に描かれたときから、全部押されている
    const s = await samples(page);
    expect(s.every((x) => x.n === x.total)).toBe(true);
  });
});

test('下から出るシートは、下へ少し引っ張っても戻り、遠くまで引くか速く払うと閉じる', async ({ page, request }) => {
  const user = newLineUser('ママ');
  await registerViaUi(page, user, ['アル']);
  await earnPoints(request, user, 10);
  await openLiff(page, user);
  const trigger = page.getByRole('button', { name: '無料券と交換する(10ポイント)' });
  const sheet = page.getByRole('dialog', { name: '無料券と交換します' });
  const grabAt = async () => {
    const g = (await page.locator('.sheet-grab').boundingBox())!;
    return { x: g.x + g.width / 2, y: g.y + 10 };
  };
  const sheetTop = async () => (await sheet.boundingBox())!.y;

  await trigger.click();
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(600);
  const restTop = await sheetTop();

  // 少しだけ引っ張ると、指について動き、離すとバネで戻る
  let p = await grabAt();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x, p.y + 40, { steps: 10 });
  expect(await sheetTop()).toBeGreaterThan(restTop + 30);
  await page.waitForTimeout(200);
  await page.mouse.up();
  await expect(sheet).toBeVisible();
  await expect.poll(sheetTop, { timeout: 2000 }).toBeLessThan(restTop + 1);

  // 遠くまで引くと閉じる
  p = await grabAt();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x, p.y + 180, { steps: 12 });
  await page.mouse.up();
  await expect(sheet).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // 短くても速く払うと閉じる
  await trigger.click();
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(600);
  p = await grabAt();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x, p.y + 60, { steps: 4 });
  await page.mouse.up();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'スタンプ' }).getByText('10 / 10', { exact: true })).toBeVisible();
});

test('動画: 会員証を開いたときの「ポポポン」(SHOT_DIR のときだけ)', async ({ browser, request }) => {
  test.skip(!SHOT_DIR, 'SHOT_DIR を指定したときだけ撮る');
  const user = newLineUser('ママ');
  const setup = await browser.newPage();
  await registerViaUi(setup, user, ['きなこ', 'だいず']);
  await earnPoints(request, user, 9);
  await setup.close();
  const dir = path.join(SHOT_DIR!, 'video');
  const context = await browser.newContext({
    viewport: { width: 390, height: 664 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'no-preference',
    recordVideo: { dir, size: { width: 390, height: 664 } },
  });
  const page = await context.newPage();
  await openLiff(page, user);
  const panel = page.getByRole('region', { name: 'スタンプ' });
  await expect(panel.locator('.paws')).toHaveAttribute('data-stamps', 'done', { timeout: 4000 });
  await page.waitForTimeout(600);
  await context.close();
});
