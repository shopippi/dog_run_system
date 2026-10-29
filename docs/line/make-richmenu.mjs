// リッチメニューの画像(docs/line/richmenu.jpg、2500×1686、1MB 以下)を、richmenu.html から作り直す。
// LINE のリッチメニューの画像は 1MB までなので、JPEG で保存する。
// 使い方: リポジトリの直下で `node docs/line/make-richmenu.mjs`
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const dir = new URL('.', import.meta.url);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 2500, height: 1686 }, deviceScaleFactor: 1 });
await page.goto(new URL('richmenu.html', dir).href);
await page.waitForLoadState('networkidle');
await page.screenshot({ path: fileURLToPath(new URL('richmenu.jpg', dir)), type: 'jpeg', quality: 86 });
await browser.close();
console.log('docs/line/richmenu.jpg を作りました');
