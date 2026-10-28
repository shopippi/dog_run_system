import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { runScheduled } from '../src/cron';
import { blockNetwork } from './analytics-helpers';

const nightly = (jstDate: string) => runScheduled('10 18 * * *', env, new Date(`${jstDate}T03:10:00+09:00`));
const lastJob = () =>
  env.DB.prepare("SELECT status, message FROM system_jobs WHERE name = 'migration_images' ORDER BY id DESC").first<{ status: string; message: string }>();

async function seed() {
  await env.DB.prepare(
    `INSERT INTO households (id, member_no, display_name, display_name_search, registered_at, updated_at)
     VALUES (1, 'DR-000001', 'アルのおうち', 'あるのおうち', '2026-01-01T00:00:00+09:00', 'x')`,
  ).run();
  const rows: [number, string, string | null][] = [
    [1, 'approved', 'requests/1/card.jpg'],
    [2, 'rejected', 'requests/2/card.jpg'],
    [3, 'pending', 'requests/3/card.jpg'],
    [4, 'approved', null],
  ];
  for (const [id, status, key] of rows) {
    await env.DB.prepare(
      `INSERT INTO requests (id, kind, household_id, attachment_key, status, created_at) VALUES (?, 'migration', 1, ?, ?, 'x')`,
    )
      .bind(id, key, status)
      .run();
    if (key) await env.MEDIA.put(key, 'jpeg');
  }
  await env.MEDIA.put('dogs/1/photo.jpg', 'jpeg');
}
async function setEnd(end: string | null) {
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('migration_period', ?, 'x')")
    .bind(JSON.stringify({ start: '2026-01-01', end }))
    .run();
}
// 毎晩の処理はバックアップも保存するので、backups/ は除いて見る
const keys = async () =>
  (await env.MEDIA.list()).objects.map((o) => o.key).filter((k) => !k.startsWith('backups/')).sort();

describe('B-06 移行用の画像の削除', () => {
  blockNetwork();

  it('移行期間の終わりから30日たつまでは消さない(境界値)', async () => {
    await seed();
    await setEnd('2026-03-01');
    await nightly('2026-03-30'); // 29日後
    expect(await keys()).toHaveLength(4);
    expect((await lastJob())!.message).toContain('2026-03-31 に消します');
  });

  it('30日たったら、承認・却下した申請の写真を消して日時を入れる。確認待ちの写真と犬の写真は残す', async () => {
    await seed();
    await setEnd('2026-03-01');
    await nightly('2026-03-31');
    expect(await keys()).toEqual(['dogs/1/photo.jpg', 'requests/3/card.jpg']);
    const { results } = await env.DB.prepare('SELECT id, attachment_key, attachment_deleted_at FROM requests ORDER BY id').all();
    expect(results).toEqual([
      { id: 1, attachment_key: 'requests/1/card.jpg', attachment_deleted_at: '2026-03-31T03:10:00+09:00' },
      { id: 2, attachment_key: 'requests/2/card.jpg', attachment_deleted_at: '2026-03-31T03:10:00+09:00' },
      { id: 3, attachment_key: 'requests/3/card.jpg', attachment_deleted_at: null },
      { id: 4, attachment_key: null, attachment_deleted_at: null },
    ]);
    expect(await lastJob()).toMatchObject({ status: 'warning' });
    expect((await lastJob())!.message).toContain('確認待ちの申請が1件');
    const log = await env.DB.prepare("SELECT actor_type, after_value FROM audit_log WHERE action = 'migration_images.delete'").first();
    expect(log).toEqual({ actor_type: 'system', after_value: JSON.stringify({ requestIds: [1, 2] }) });

    // 確認待ちが片づいたら、次の晩に消す
    await env.DB.prepare("UPDATE requests SET status = 'approved' WHERE id = 3").run();
    await nightly('2026-04-01');
    expect(await keys()).toEqual(['dogs/1/photo.jpg']);
    expect(await lastJob()).toMatchObject({ status: 'ok', message: '引き継ぎ申請の写真を1枚消しました。' });
  });

  it('移行期間の終わりが決まっていなければ、何もしない', async () => {
    await seed();
    await nightly('2027-01-01');
    expect(await keys()).toHaveLength(4);
    expect(await lastJob()).toMatchObject({ status: 'ok', message: '移行期間の終わりが決まっていないため、写真は消していません。' });
  });
});
