import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { auditPage, shotPath } from './visual-qa-helpers';

// デモ画面(apps/demo)の外側の枠(手順・お客さんのスマホ・LINE のトーク)の見え方の点検。
// 重なり・切れ・はみ出し・押しにくさを e2e/visual-qa-helpers.ts で確かめる。中の画面(iframe)は LIFF・管理画面の点検で見る。

const WASM = fs.readFileSync(path.resolve(__dirname, '../apps/demo/node_modules/sql.js/dist/sql-wasm.wasm'));

const VIEWPORTS = [
  { name: 'demo-360', viewport: { width: 360, height: 740 }, touch: true },
  { name: 'demo-390', viewport: { width: 390, height: 844 }, touch: true },
  { name: 'demo-768', viewport: { width: 768, height: 1024 }, touch: true },
  { name: 'demo-1280', viewport: { width: 1280, height: 800 }, touch: false },
] as const;

for (const vp of VIEWPORTS) {
  test(`見え方の点検 デモ画面 ${vp.name}`, async ({ browser }) => {
    test.setTimeout(90_000);
    const page = await browser.newPage({ viewport: vp.viewport, hasTouch: vp.touch, isMobile: vp.touch && vp.viewport.width < 500 });
    await page.route(/sql-wasm\.wasm$/, (route) =>
      route.fulfill({ body: WASM, contentType: 'application/wasm', headers: { 'access-control-allow-origin': '*' } }),
    );
    await page.goto('/');
    await page.getByRole('heading', { name: '打ち合わせ用の手順' }).waitFor({ timeout: 30_000 });
    await page.frameLocator('iframe[title="受付・管理画面"]').getByRole('button', { name: 'ログアウト' }).waitFor();
    await page.getByRole('button', { name: /^3\s/ }).click();
    await page.frameLocator('iframe[title="お客さんのスマホ"]').getByRole('button', { name: 'LINEで招待を送る' }).click();
    await expect(page.getByRole('region', { name: 'LINE のトーク' })).toContainText('こむぎママさんから');
    const opts = { minTap: vp.touch ? 44 : 40, checkCovered: false };
    const problems: string[] = [];
    const r1 = await auditPage(page, opts);
    problems.push(...r1.problems.map((p) => `手順とトーク: ${p}`));
    const f1 = shotPath(vp.name, 'デモ(手順・スマホ・LINE のトーク)');
    if (f1) await page.screenshot({ path: f1, fullPage: true });

    await page.getByRole('button', { name: '最初からやり直す' }).click();
    await expect(page.getByRole('dialog', { name: '最初からやり直す' })).toBeVisible();
    const r2 = await auditPage(page, opts);
    problems.push(...r2.problems.map((p) => `やり直しの確認: ${p}`));
    const f2 = shotPath(vp.name, 'デモ(やり直しの確認)');
    if (f2) await page.screenshot({ path: f2 });
    if (process.env.VQA_WARN) console.log([...r1.warnings, ...r2.warnings].join('\n'));
    await page.close();
    expect(problems).toEqual([]);
  });
}
