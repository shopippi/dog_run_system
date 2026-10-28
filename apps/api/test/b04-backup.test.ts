import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { runScheduled } from '../src/cron';
import { blockNetwork } from './analytics-helpers';
import { adminCall, checkin, createStaff, login, registerUser } from './helpers';

const NOW = '2026-10-28T01:00:00Z';

async function cookieOf(role: 'staff' | 'admin' | 'developer') {
  await createStaff(`${role}@example.com`, role);
  return login(`${role}@example.com`);
}
type Backup = { format: string; createdAt: string; tables: Record<string, { columns: string[]; rows: unknown[][] }> };
async function readBackup(key: string): Promise<Backup> {
  const obj = await env.MEDIA.get(key);
  if (!obj) throw new Error(`${key} がない`);
  return obj.json<Backup>();
}

describe('B-04 バックアップ', () => {
  blockNetwork();

  it('管理者が手動で実行すると、全テーブルを JSON にして R2 の backups/<日付>.json に保存する', async () => {
    const admin = await cookieOf('admin');
    const r = await registerUser('U001:パパ');
    await checkin('U001:パパ', [r.dogs[0]!.id], { now: NOW });
    const res = await adminCall('/admin/api/system/backup', { cookie: admin, body: {}, now: NOW });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');

    const b = await readBackup('backups/2026-10-28.json');
    expect(b.format).toBe('dog-run-backup');
    expect(b.createdAt).toBe('2026-10-28T10:00:00+09:00');
    expect(Object.keys(b.tables)).toEqual(
      expect.arrayContaining(['households', 'family_members', 'dogs', 'visits', 'point_ledger', 'settings', 'audit_log', 'system_jobs']),
    );
    const h = b.tables.households!;
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]![h.columns.indexOf('member_no')]).toBe(r.memberNo);
    expect(b.tables.visits!.rows).toHaveLength(1);
    // 空の表も列の名前を残す
    expect(b.tables.merges!.rows).toEqual([]);
    expect(b.tables.merges!.columns).toContain('kept_household_id');

    const job = await env.DB.prepare("SELECT status, message FROM system_jobs WHERE name = 'backup'").first<{ status: string; message: string }>();
    expect(job!.status).toBe('ok');
    expect(job!.message).toMatch(/個の表\(合計\d+行/);
    const log = await env.DB.prepare("SELECT action FROM audit_log WHERE action = 'system.backup'").first();
    expect(log).toEqual({ action: 'system.backup' });
  });

  it('大きな表も、すべての行を保存する(少しずつ読む)', async () => {
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 4500)
       INSERT INTO events (date, name, created_at) SELECT '2026-10-01', 'イベント' || i, 'x' FROM n`,
    ).run();
    await runScheduled('10 18 * * *', env, new Date('2026-10-28T03:10:00+09:00'));
    const b = await readBackup('backups/2026-10-28.json');
    const ev = b.tables.events!;
    expect(ev.rows).toHaveLength(4500);
    expect(ev.rows.at(-1)![ev.columns.indexOf('name')]).toBe('イベント4500');
  });

  it('毎晩の実行で、今日を含めて30日分だけを残し、それより前のバックアップを消す', async () => {
    for (const key of ['backups/2026-09-28.json', 'backups/2026-09-29.json', 'backups/2026-01-01.json', 'backups/memo.txt', 'dogs/1/a.jpg']) {
      await env.MEDIA.put(key, '{}');
    }
    await runScheduled('10 18 * * *', env, new Date('2026-10-28T03:10:00+09:00'));
    const { objects } = await env.MEDIA.list();
    expect(objects.map((o) => o.key).sort()).toEqual([
      'backups/2026-09-29.json', // 29日前は残す
      'backups/2026-10-28.json',
      'backups/memo.txt',
      'dogs/1/a.jpg',
    ]);
    const job = await env.DB.prepare("SELECT message FROM system_jobs WHERE name = 'backup'").first<{ message: string }>();
    expect(job!.message).toContain('2件消しました');
  });

  it('受付スタッフと製作者は実行できない', async () => {
    const staff = await cookieOf('staff');
    expect((await adminCall('/admin/api/system/backup', { cookie: staff, body: {}, now: NOW })).status).toBe(403);
    const dev = await cookieOf('developer');
    expect((await adminCall('/admin/api/system/backup', { cookie: dev, body: {}, now: NOW })).status).toBe(403);
    expect((await env.MEDIA.list()).objects).toHaveLength(0);
  });
});
