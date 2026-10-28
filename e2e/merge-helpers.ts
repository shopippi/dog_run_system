import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { answerSurvey, makePhoto, openLiff } from './helpers';

// 担当B(おうちの統合・確認待ち・旧カードの移行)と担当H(お客さん同士でまとめる)の e2e で使う補助。

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

/** すでに別のおうちがある人が招待を開く(C-12)。「おうちを一つにまとめる」の画面が出るまで待つ */
export async function openMergeInvite(page: Page, inviter: string, opener: string) {
  const invitePath = await sendInvite(page, inviter);
  await openLiff(page, opener, invitePath);
  await expect(page.getByRole('heading', { name: 'おうちを一つにまとめる' })).toBeVisible();
  return invitePath;
}

/** 写真つきで登録する(最初のワンちゃんだけ写真つき)。会員IDを返す */
export async function registerWithPhoto(page: Page, user: string, names: [string, ...string[]]) {
  await openLiff(page, user);
  await page.getByLabel('利用規約とプライバシーポリシーに同意します').check();
  await page.getByRole('button', { name: '同意して次へ' }).click();
  for (const [i, name] of names.entries()) {
    if (i > 0) await page.getByRole('button', { name: 'もう1頭追加する' }).click();
    const form = page.locator('fieldset.dog-form').nth(i);
    await form.getByLabel('名前').fill(name);
    await form.getByRole('combobox', { name: /犬種/ }).selectOption({ label: i === 0 ? '柴犬' : 'プードル' });
    if (i === 0) {
      await form.locator('input[type=file]').setInputFiles({ name: 'a.jpg', mimeType: 'image/jpeg', buffer: await makePhoto(page) });
      await form.locator('img.av').waitFor();
    }
  }
  await page.getByRole('button', { name: '次へ' }).click();
  await answerSurvey(page);
  await page.getByRole('button', { name: '登録する' }).click();
  await page.getByText('登録が完了しました').waitFor();
  return (await page.locator('.welcome-card .id').textContent())!;
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

/**
 * 昨日の来場を直接入れる(1ポイントつき)。今日の来場の一覧を長くしないため、統合・確認待ちの準備ではこちらを使う。
 * 「写真で探す」(最近来たおうち)にも出る。
 */
export function visitYesterday(memberNo: string) {
  const day = "date('now', '+9 hours', '-1 day')";
  const at = "strftime('%Y-%m-%dT10:00:00+09:00', 'now', '+9 hours', '-1 day')";
  const h = `(SELECT id FROM households WHERE member_no = '${memberNo}')`;
  const v = `(SELECT id FROM visits WHERE household_id = ${h} AND visit_date = ${day} AND cancelled_at IS NULL)`;
  sql(
    `INSERT INTO visits (household_id, checked_in_member_id, visit_date, checked_in_at, dog_count, used_ticket, method)
       SELECT ${h}, (SELECT MIN(id) FROM family_members WHERE household_id = ${h}), ${day}, ${at},
              (SELECT COUNT(*) FROM dogs WHERE household_id = ${h} AND status = 'active'), 0, 'self';
     INSERT INTO visit_dogs (visit_id, dog_id, visit_date, created_at)
       SELECT ${v}, id, ${day}, ${at} FROM dogs WHERE household_id = ${h} AND status = 'active';
     INSERT INTO point_ledger (household_id, delta, kind, visit_id, actor_type, created_at)
       SELECT ${h}, 1, 'visit', ${v}, 'member', ${at};`,
  );
}
