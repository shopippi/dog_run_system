// リッチメニューの画像(2500×1686、1MB 以下の JPEG)を、HTML から作り直す。
//
// 使い方(リポジトリの直下で):
//   node docs/line/make-richmenu.mjs              いま使っている案(richmenu.html → richmenu.jpg)
//   node docs/line/make-richmenu.mjs dark         ほかの案(alt/dark.html → alt/dark.jpg)
//   node docs/line/make-richmenu.mjs --all        すべての案
//   node docs/line/make-richmenu.mjs --grid ...   LINE の 6 マスの線を重ねた確認用の画像も作る(一時フォルダ)
//   node docs/line/make-richmenu.mjs --list       作れる案の一覧
//
// 文字は Google Fonts を使うので、インターネットにつながった状態で実行する。
// 読み込めなかったときは、違う文字で撮らないように止まる。
import { chromium } from '@playwright/test';
import { readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const W = 2500;
const H = 1686;
/** LINE の「大」6 マス(3 列 × 2 段)の区切り。左上が 0,0 */
const COLS = [0, 833, 1667, 2500];
const ROWS = [0, 843, 1686];
const LIMIT = 1024 * 1024; // LINE の上限
const TARGET = 800 * 1024; // これより小さくする

const dir = fileURLToPath(new URL('.', import.meta.url));
const variants = { default: { html: 'richmenu.html', out: 'richmenu.jpg' } };
for (const f of readdirSync(join(dir, 'alt')).filter((f) => f.endsWith('.html')).sort()) {
  const name = f.replace(/\.html$/, '');
  variants[name] = { html: `alt/${f}`, out: `alt/${name}.jpg` };
}

const args = process.argv.slice(2);
if (args.includes('--list')) {
  for (const [name, v] of Object.entries(variants)) console.log(`${name.padEnd(10)} ${v.html} → ${v.out}`);
  process.exit(0);
}
const grid = args.includes('--grid');
const names = args.includes('--all') ? Object.keys(variants) : args.filter((a) => !a.startsWith('--'));
if (names.length === 0) names.push('default');
for (const n of names) {
  if (!variants[n]) {
    console.error(`「${n}」という案はありません。--list で一覧を出せます。`);
    process.exit(1);
  }
}

// プロキシの中で動かすとき(HTTPS_PROXY があるとき)は、ブラウザにも同じプロキシを使わせる
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch(proxy ? { proxy: { server: proxy } } : {});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

for (const name of names) {
  const v = variants[name];
  await page.goto(pathToFileURL(join(dir, v.html)).href);
  await page.waitForLoadState('networkidle');
  // Web フォントを待つ。HTML の <meta name="fonts"> に書いたフォントが、画面の文字で読めたかを確かめる
  const missing = await page.evaluate(async () => {
    await document.fonts.ready;
    const specs = (document.querySelector('meta[name="fonts"]')?.getAttribute('content') ?? '').split('|').map((s) => s.trim()).filter(Boolean);
    const text = document.body.innerText.replace(/\s+/g, '');
    const bad = [];
    for (const spec of specs) {
      await document.fonts.load(spec, text).catch(() => {});
      if (!document.fonts.check(spec, text)) bad.push(spec);
    }
    await document.fonts.ready;
    return bad;
  });
  if (missing.length) {
    console.error(`${v.html}: フォントを読み込めませんでした(${missing.join(', ')})。インターネットにつながっているか確かめて、もう一度実行してください。`);
    process.exitCode = 1;
    continue;
  }
  // 1MB を超えないように(できれば 800KB 以下に)画質を下げながら保存する
  const out = join(dir, v.out);
  let quality = 88;
  for (;;) {
    await page.screenshot({ path: out, type: 'jpeg', quality });
    const size = statSync(out).size;
    if (size <= TARGET || quality <= 60) {
      if (size > LIMIT) throw new Error(`${v.out} が 1MB を超えました(${Math.round(size / 1024)}KB)`);
      console.log(`docs/line/${v.out} を作りました(${Math.round(size / 1024)}KB、画質 ${quality})`);
      break;
    }
    quality -= 4;
  }
  if (grid) {
    await page.evaluate(({ COLS, ROWS }) => {
      const g = document.createElement('div');
      g.style.cssText = 'position:fixed;inset:0;z-index:99999;pointer-events:none';
      for (const x of COLS.slice(1, -1)) g.insertAdjacentHTML('beforeend', `<div style="position:absolute;top:0;bottom:0;left:${x - 2}px;width:4px;background:#ff00aa"></div>`);
      for (const y of ROWS.slice(1, -1)) g.insertAdjacentHTML('beforeend', `<div style="position:absolute;left:0;right:0;top:${y - 2}px;height:4px;background:#ff00aa"></div>`);
      document.body.append(g);
    }, { COLS, ROWS });
    const p = join(tmpdir(), `richmenu-${name}-grid.jpg`);
    await page.screenshot({ path: p, type: 'jpeg', quality: 80 });
    console.log(`  確認用(6 マスの線つき): ${p}`);
  }
}
await browser.close();
