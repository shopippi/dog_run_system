// リッチメニューの画像(docs/line/richmenu.png、2500×1686)を、richmenu.html から作り直す。
// 使い方: リポジトリの直下で `node docs/line/make-richmenu.mjs`
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const dir = new URL('.', import.meta.url);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 2500, height: 1686 }, deviceScaleFactor: 1 });
await page.goto(new URL('richmenu.html', dir).href);
await page.screenshot({ path: fileURLToPath(new URL('richmenu.png', dir)), type: 'png' });
await browser.close();
console.log('docs/line/richmenu.png を作りました');
