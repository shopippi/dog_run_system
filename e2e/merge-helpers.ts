import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { openLiff } from './helpers';

// 担当B(おうちの統合・確認待ち・旧カードの移行)の e2e で使う補助。

/** テスト用のデータベースに SQL を実行する(お客さんの申請の画面がまだないものの準備に使う) */
export function sql(command: string): { [key: string]: unknown }[] {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', '.wrangler/e2e', '--json', '--command', command],
    { cwd: path.resolve(__dirname, '../apps/api'), encoding: 'utf8' },
  );
  return JSON.parse(out)[0].results as { [key: string]: unknown }[];
}

/** 家族の招待を送り、招待の URL(/invite/...)を返す */
export async function sendInvite(page: Page, user: string): Promise<string> {
  await openLiff(page, user, '/family');
  await page.getByRole('button', { name: 'LINEで招待を送る' }).click();
  await expect(page.getByRole('status')).toContainText('招待を送りました');
  const messages = await page.evaluate(() => (window as unknown as { __sharedMessages: string[] }).__sharedMessages);
  return messages.at(-1)!.match(/\/liff(\/invite\/[A-Za-z0-9_-]+)/)![1]!;
}

/** すでに別のおうちがある人が招待を開いて、まとめる申請をする(C-12) */
export async function requestMerge(page: Page, inviter: string, requester: string) {
  const invitePath = await sendInvite(page, inviter);
  await openLiff(page, requester, invitePath);
  await page.getByRole('button', { name: 'おうちをまとめる申請をする' }).click();
  await expect(page.getByRole('status')).toContainText('おうちをまとめる申請をしました');
}

/** 写真の保存先(R2)に画像を置く(旧カードの写真の準備に使う) */
export function putMedia(key: string, body: Buffer) {
  const dir = path.resolve(__dirname, '../test-results');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `media-${Date.now()}.jpg`);
  writeFileSync(file, body);
  execFileSync(
    'npx',
    ['wrangler', 'r2', 'object', 'put', `dog-run-media/${key}`, '--file', file, '--content-type', 'image/jpeg', '--local', '--persist-to', '.wrangler/e2e'],
    { cwd: path.resolve(__dirname, '../apps/api'), encoding: 'utf8', stdio: 'pipe' },
  );
}

/** 旧カードの引き継ぎ申請(C-10 の形)を直接入れる。会員IDのおうちの最初の家族が申請したことにする */
export function insertMigrationRequest(memberNo: string, payload: { source: string; claimedPoints: number; note?: string }, attachmentKey: string | null) {
  const json = JSON.stringify(payload).replace(/'/g, "''");
  sql(
    `INSERT INTO requests (kind, household_id, requester_member_id, payload, attachment_key, status, created_at)
     SELECT 'migration', h.id, (SELECT id FROM family_members WHERE household_id = h.id ORDER BY id LIMIT 1), '${json}',
            ${attachmentKey ? `'${attachmentKey}'` : 'NULL'}, 'pending', strftime('%Y-%m-%dT%H:%M:%S+09:00', 'now', '+9 hours')
       FROM households h WHERE h.member_no = '${memberNo}'`,
  );
}
