// 管理画面のアカウントを作る(製作者が使う)。最初の管理者と、製作者(閲覧のみ)のアカウントはこれで作る。
// 受付スタッフのアカウントは、管理画面のスタッフの管理(A-13)から作れるようになる。
//
// 使い方(apps/api で):
//   STAFF_PASSWORD='...' node scripts/create-staff.mjs --email owner@example.com --name 管理者 --role admin [--remote] [--env production]
// --remote を付けないと、ローカルのデータベースに作る。
import { execFileSync } from 'node:child_process';
import { pbkdf2Sync, randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const email = opt('email')?.trim().toLowerCase();
const name = opt('name') ?? '管理者';
const role = opt('role') ?? 'admin';
const password = process.env.STAFF_PASSWORD;

if (!email || !password || !['staff', 'admin', 'developer'].includes(role)) {
  console.error('使い方: STAFF_PASSWORD=... node scripts/create-staff.mjs --email <メール> --name <名前> --role <staff|admin|developer> [--remote] [--env production]');
  process.exit(1);
}
if (password.length < 10) {
  console.error('パスワードは10文字以上にしてください。');
  process.exit(1);
}

// apps/api/src/lib/password.ts と同じ形式
const iterations = 100000;
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
const passwordHash = `pbkdf2-sha256$${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`;

const now = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19) + '+09:00';
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sql =
  `INSERT INTO staff_users (email, name, password_hash, role, status, created_at, updated_at) ` +
  `VALUES (${q(email)}, ${q(name)}, ${q(passwordHash)}, ${q(role)}, 'active', ${q(now)}, ${q(now)}) ` +
  `ON CONFLICT (email) DO UPDATE SET password_hash = excluded.password_hash, role = excluded.role, ` +
  `status = 'active', failed_login_count = 0, locked_until = NULL, updated_at = excluded.updated_at;`;

const wranglerArgs = ['wrangler', 'd1', 'execute', 'DB', args.includes('--remote') ? '--remote' : '--local', '--command', sql];
const env = opt('env');
if (env) wranglerArgs.push('--env', env);
const persist = opt('persist-to');
if (persist) wranglerArgs.push('--persist-to', persist);
execFileSync('npx', wranglerArgs, { stdio: 'inherit' });
console.log(`${email}(${role})を作りました。`);
