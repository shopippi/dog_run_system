import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { runScheduled } from '../src/cron';
import { levelOf } from '../src/services/system-status';
import { blockNetwork } from './analytics-helpers';
import { adminCall, createStaff, dog, login, registerUser } from './helpers';

const NOW = '2026-10-28T01:00:00Z'; // 日本時間 10:00

async function cookieOf(role: 'staff' | 'admin' | 'developer') {
  await createStaff(`${role}@example.com`, role);
  return login(`${role}@example.com`, 'password-1234', NOW);
}
type Job = { name: string; level: string; summary: string; lastRun: { status: string } | null };
const jobOf = (body: { jobs: Job[] }, name: string) => body.jobs.find((j) => j.name === name)!;

describe('A-17・D-02 システムの状態', () => {
  blockNetwork();

  it('まだ何も動いていないときは、すべて黄色(使い始め)', async () => {
    const admin = await cookieOf('admin');
    const res = await adminCall('/admin/api/system-status', { cookie: admin, now: NOW });
    expect(res.status).toBe(200);
    expect(res.body.overall).toBe('yellow');
    expect(res.body.jobs.map((j: Job) => j.name)).toEqual(['weather', 'holidays', 'daily_stats', 'backup', 'expiry', 'migration_images']);
    expect(res.body.jobs.every((j: Job) => j.level === 'yellow')).toBe(true);
    expect(res.body.detail).toBeNull();
  });

  it('毎晩・毎朝の処理の結果から、処理ごとに緑・黄・赤を出す。赤のときは製作者の連絡先を出す', async () => {
    await env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('developer_contact', '"山田(090-0000-0000)"', 'x')`,
    ).run();
    // 外のサイトにつながらない(天気と祝日は失敗する)
    await runScheduled('10 18 * * *', env, new Date('2026-10-28T03:10:00+09:00'));
    await runScheduled('10 20 * * *', env, new Date('2026-10-28T05:10:00+09:00'));
    const admin = await cookieOf('admin');
    const res = await adminCall('/admin/api/system-status', { cookie: admin, now: NOW });
    expect(jobOf(res.body, 'daily_stats').level).toBe('green');
    expect(jobOf(res.body, 'backup').level).toBe('green');
    expect(jobOf(res.body, 'expiry').level).toBe('green');
    // 一度も成功していない天気は赤
    expect(jobOf(res.body, 'weather')).toMatchObject({ level: 'red', lastRun: { status: 'failed' } });
    expect(res.body.overall).toBe('red');
    expect(res.body.contact).toBe('山田(090-0000-0000)');
  });

  it('色の決め方(境界値): 毎日の処理は、最後の成功から30時間までは緑、60時間までは黄、それより前は赤', () => {
    const now = new Date('2026-10-28T12:00:00+09:00');
    const run = (status: 'ok' | 'warning' | 'failed' | 'running', startedAt: string) => ({
      name: 'backup' as const,
      label: 'バックアップ',
      startedAt,
      finishedAt: startedAt,
      status,
      message: null,
    });
    const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3600_000).toISOString();
    expect(levelOf('backup', run('ok', at(30)), at(30), now).level).toBe('green');
    expect(levelOf('backup', run('ok', at(31)), at(31), now).level).toBe('yellow');
    expect(levelOf('backup', run('ok', at(60)), at(60), now).level).toBe('yellow');
    expect(levelOf('backup', run('ok', at(61)), at(61), now).level).toBe('red');
    // 成功の後に失敗した → 黄(次でやり直す)
    expect(levelOf('backup', run('failed', at(1)), at(25), now).level).toBe('yellow');
    // 一部だけ → 黄
    expect(levelOf('backup', run('warning', at(1)), at(1), now).level).toBe('yellow');
    // 「動いています」のまま1時間を過ぎた → 止まったとみなす
    expect(levelOf('backup', run('running', at(2)), at(25), now).level).toBe('yellow');
    expect(levelOf('backup', run('running', at(2)), null, now).level).toBe('red');
    // 祝日は年1回なので、半年前の成功でも緑
    expect(levelOf('holidays', { ...run('ok', at(24 * 180)), name: 'holidays' }, at(24 * 180), now).level).toBe('green');
  });

  it('製作者には、エラーの記録・実行の履歴・データ量・写真の容量の見込みも出す', async () => {
    await registerUser('U001:パパ', [dog('アル'), dog('ニコ')]);
    await env.DB.prepare("UPDATE dogs SET photo_key = 'dogs/1/a.jpg' WHERE id IN (1, 2)").run();
    await runScheduled('10 20 * * *', env, new Date('2026-10-28T05:10:00+09:00'));
    const dev = await cookieOf('developer');
    const res = await adminCall('/admin/api/system-status', { cookie: dev, now: NOW });
    expect(res.status).toBe(200);
    const d = res.body.detail;
    expect(d.recentFailures[0]).toMatchObject({ name: 'weather', label: '天気の取得', status: 'failed' });
    expect(d.history.length).toBeGreaterThan(0);
    expect(d.tables.find((t: { name: string }) => t.name === 'households')).toEqual({ name: 'households', label: 'おうち', rows: 1 });
    expect(d.tables.find((t: { name: string }) => t.name === 'dogs').rows).toBe(2);
    expect(d.photos).toEqual({ count: 2, estimatedBytes: 2 * 150 * 1024, limitBytes: 10 * 1024 ** 3 });
  });

  it('管理者は「今すぐ実行」で処理を動かせる。結果を記録し、操作ログにも残す', async () => {
    const admin = await cookieOf('admin');
    const res = await adminCall('/admin/api/system/run/daily_stats', { cookie: admin, body: {}, now: NOW });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    const status = await adminCall('/admin/api/system-status', { cookie: admin, now: NOW });
    expect(jobOf(status.body, 'daily_stats').level).toBe('green');
    const log = await env.DB.prepare("SELECT action FROM audit_log WHERE action = 'system.run.daily_stats'").first();
    expect(log).toEqual({ action: 'system.run.daily_stats' });

    const backup = await adminCall('/admin/api/system/run/backup', { cookie: admin, body: {}, now: NOW });
    expect(backup.body.status).toBe('ok');
    // ここから動かせない処理は 404
    expect((await adminCall('/admin/api/system/run/expiry', { cookie: admin, body: {}, now: NOW })).status).toBe(404);
  });

  it('受付スタッフは見られない。製作者は見られるが、実行はできない', async () => {
    const staff = await cookieOf('staff');
    expect((await adminCall('/admin/api/system-status', { cookie: staff, now: NOW })).status).toBe(403);
    expect((await adminCall('/admin/api/system/run/backup', { cookie: staff, body: {}, now: NOW })).status).toBe(403);
    const dev = await cookieOf('developer');
    expect((await adminCall('/admin/api/system/run/backup', { cookie: dev, body: {}, now: NOW })).status).toBe(403);
  });
});
