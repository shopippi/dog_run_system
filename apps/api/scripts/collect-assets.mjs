// apps/liff と apps/admin のビルド結果を、Worker が配信する public/ にまとめる。
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(here, '..');
const publicDir = path.join(apiDir, 'public');

rmSync(publicDir, { recursive: true, force: true });
mkdirSync(publicDir, { recursive: true });

for (const app of ['liff', 'admin']) {
  const dist = path.resolve(apiDir, '..', app, 'dist');
  if (!existsSync(dist)) {
    console.error(`${app} のビルド結果がありません(${dist})。先に pnpm --filter @dr/${app} build を実行してください。`);
    process.exit(1);
  }
  cpSync(dist, path.join(publicDir, app), { recursive: true });
}
// 配信のときの保存の決まり(Cloudflare の静的ファイルの _headers)。電波が弱い場所でも、2回目からはすぐ開けるように:
// - 名前にハッシュが入ったファイル(assets/)は中身が変わらないので、1年保存し、確かめにも来させない(immutable)
// - index.html は毎回確かめさせる(新しい版を配信したら、すぐに新しい assets/ を読むように)
writeFileSync(
  path.join(publicDir, '_headers'),
  [
    '/liff/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/admin/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/liff/',
    '  Cache-Control: no-cache',
    '/liff/index.html',
    '  Cache-Control: no-cache',
    '/admin/',
    '  Cache-Control: no-cache',
    '/admin/index.html',
    '  Cache-Control: no-cache',
    '',
  ].join('\n'),
);
console.log(`画面のファイルを ${publicDir} にまとめました`);
