import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// デモ(apps/demo)の初期データで、ダッシュボード(M-05)が見栄え良く出ること(天気・郵便番号・メモの入った初期データ)。
// SHOT_DIR を指定すると、管理画面の枠を広げて全体の写真を保存する。

const WASM = fs.readFileSync(path.resolve(__dirname, '../apps/demo/node_modules/sql.js/dist/sql-wasm.wasm'));
test.beforeEach(async ({ context }) => {
  await context.route(/sql-wasm\.wasm$/, (route) =>
    route.fulfill({ body: WASM, contentType: 'application/wasm', headers: { 'access-control-allow-origin': '*' } }),
  );
});

const adminFrame = (page: Page) => page.frameLocator('iframe[title="受付・管理画面"]');

test('デモ: ダッシュボードに、数字・グラフ・天気と来場・カレンダー(メモの印)・地域が出る', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await page.getByRole('heading', { name: '打ち合わせ用の手順' }).waitFor({ timeout: 30_000 });
  const a = adminFrame(page);
  await a.getByRole('button', { name: 'ログアウト' }).waitFor();
  await a.getByRole('link', { name: 'ダッシュボード' }).click();
  const kpis = a.getByRole('region', { name: '期間の集計' });
  await expect(kpis.getByRole('button', { name: /^来場組数/ })).toBeVisible();
  await expect(kpis.getByRole('button', { name: /^来場組数 0組/ })).toHaveCount(0);
  await expect(a.getByRole('list', { name: /天気ごとの1日あたりの来場/ })).toBeVisible();
  await expect(a.getByRole('table', { name: '市区町村ごとのおうちと来場' }).getByText('世田谷区')).toBeVisible();
  const cal = a.getByRole('group', { name: /のカレンダー$/ });
  await expect(cal.getByRole('button', { name: /メモ1件/ }).first()).toBeVisible();
  // AI に渡す分析パック(デモの初期データ)。SHOT_DIR があればサンプルとして保存する
  await a.getByRole('link', { name: 'CSV出力' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), a.getByRole('button', { name: 'ダウンロード' }).click()]);
  const text = fs.readFileSync((await dl.path())!, 'utf8');
  expect(text.slice(1).startsWith('# ')).toBe(true);
  expect(text).toContain('朝から雨。');
  if (process.env.SHOT_DIR) fs.writeFileSync(`${process.env.SHOT_DIR}/AIに渡す分析パック(デモのサンプル).csv`, text);
  await a.getByRole('link', { name: 'ダッシュボード' }).click();
  await a.locator('.dsb-cal-cell.today').waitFor();

  if (process.env.SHOT_DIR) {
    const frame = page.locator('iframe[title="受付・管理画面"]');
    for (const [w, name] of [[1280, 'デモ M-05 ダッシュボード 1280'], [768, 'デモ M-05 ダッシュボード 768']] as const) {
      await page.setViewportSize({ width: Math.max(1400, w + 40), height: 1000 });
      await frame.evaluate((el: HTMLIFrameElement, width) => {
        el.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:4200px;z-index:99999;background:#fff`;
      }, w);
      await page.waitForTimeout(800);
      await frame.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
    }
  }
});
