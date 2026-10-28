import { execFileSync } from 'node:child_process';
import path from 'node:path';

// 担当D(分析と自動処理)の e2e の補助。

/** e2e のデータベース(e2e/start-server.sh が作る)に SQL を直接流す。画面からは作れない古い来場などの準備に使う */
export function d1(sql: string): unknown[] {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', '.wrangler/e2e', '--json', '--command', sql],
    { cwd: path.resolve(__dirname, '../apps/api'), encoding: 'utf8' },
  );
  const parsed = JSON.parse(out) as { results: unknown[] }[];
  return parsed.at(-1)?.results ?? [];
}

/** 日本時間の今日から n 日前の日付 */
export function daysAgo(n: number): string {
  const d = new Date(Date.now() + 9 * 3600_000 - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** 会員IDからおうちの内部の番号 */
export function householdIdOf(memberNo: string): number {
  const rows = d1(`SELECT id FROM households WHERE member_no = '${memberNo.replace(/'/g, "''")}'`) as { id: number }[];
  return rows[0]!.id;
}
