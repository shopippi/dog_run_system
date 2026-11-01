// デモのビルド。お客さん向け画面と管理画面を、デモ用(VITE_DEMO=1、相対パス)にビルドしてから、
// デモ画面をビルドし、dist/liff と dist/admin に入れる。dist/ の中だけで動く(静的なファイルだけ)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const demo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apps = path.resolve(demo, '..');
// 出力先(DEMO_OUT で変えられる。e2e がデモを配信しているあいだに、別の場所へ作るため)
const out = path.resolve(demo, process.env.DEMO_OUT ?? 'dist');
const tmp = path.join(demo, 'node_modules', process.env.DEMO_OUT ? '.demo-apps-out' : '.demo-apps');

process.env.VITE_DEMO = '1';
// LIFF はモックで動かす(手元の .env に LIFF ID があっても使わない)
process.env.VITE_LIFF_ID = '';
for (const app of ['liff', 'admin']) {
  const root = path.join(apps, app);
  await build({
    root,
    configFile: path.join(root, 'vite.config.ts'),
    base: './',
    logLevel: 'warn',
    build: { outDir: path.join(tmp, app), emptyOutDir: true },
  });
}
delete process.env.VITE_DEMO;
delete process.env.VITE_LIFF_ID;

await build({ root: demo, configFile: path.join(demo, 'vite.config.ts'), logLevel: 'warn', build: { outDir: out, emptyOutDir: true } });
for (const app of ['liff', 'admin']) {
  fs.cpSync(path.join(tmp, app), path.join(out, app), { recursive: true });
}
fs.rmSync(tmp, { recursive: true, force: true });
// SQLite の本体(WASM)を同梱する(CDN につながらない環境でも動くように)
const wasm = fileURLToPath(import.meta.resolve('sql.js/dist/sql-wasm.wasm'));
fs.copyFileSync(wasm, path.join(out, 'sql-wasm.wasm'));
console.log(`デモをビルドしました: ${path.relative(process.cwd(), out)}/index.html`);
