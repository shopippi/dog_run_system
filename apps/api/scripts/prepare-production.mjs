// 本番の D1 データベースと R2 の保存先を用意し(なければ作る)、wrangler.toml の [env.production] の database_id を本当の ID に置き換える。
// 配信(.github/workflows/deploy.yml)と、アカウント作成(create-staff.yml)から使う。CLOUDFLARE_API_TOKEN と CLOUDFLARE_ACCOUNT_ID が要る。
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const DB_NAME = 'dog-run-production';
const BUCKET = 'dog-run-production-media';
const createIfMissing = !process.argv.includes('--no-create');

const wrangler = (args, opts = {}) =>
  execFileSync('pnpm', ['exec', 'wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts });

function findDb() {
  const list = JSON.parse(wrangler(['d1', 'list', '--json']));
  return list.find((d) => d.name === DB_NAME);
}

let db = findDb();
if (!db) {
  if (!createIfMissing) throw new Error(`D1 データベース ${DB_NAME} がありません。先に配信(Deploy)を動かしてください。`);
  console.log(`D1 データベース ${DB_NAME} を作ります`);
  wrangler(['d1', 'create', DB_NAME]);
  db = findDb();
}
const id = db?.uuid ?? db?.id;
if (!id) throw new Error('D1 の ID が取れませんでした');
console.log(`D1 の ID: ${id}`);

const toml = readFileSync('wrangler.toml', 'utf8');
const i = toml.indexOf('[env.production]');
writeFileSync('wrangler.toml', toml.slice(0, i) + toml.slice(i).replace(/database_id = "[^"]*"/, `database_id = "${id}"`));

if (createIfMissing) {
  const buckets = wrangler(['r2', 'bucket', 'list']);
  if (!buckets.includes(BUCKET)) {
    console.log(`R2 の保存先 ${BUCKET} を作ります(公開はしない)`);
    wrangler(['r2', 'bucket', 'create', BUCKET]);
  }
}
