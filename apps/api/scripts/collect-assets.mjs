// apps/liff と apps/admin のビルド結果を、Worker が配信する public/ にまとめる。
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
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
console.log(`画面のファイルを ${publicDir} にまとめました`);
