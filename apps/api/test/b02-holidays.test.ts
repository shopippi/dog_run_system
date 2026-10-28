import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runScheduled } from '../src/cron';
import { HOLIDAY_CSV_URL, parseHolidayCsv } from '../src/services/holidays';
import { adminCall, createStaff, login } from './helpers';

// 内閣府の CSV と同じ形(Shift_JIS)。中身:
// 国民の祝日・休日月日,国民の祝日・休日名称 / 2019/1/1,元日 / 2026/1/1,元日 / 2026/11/3,文化の日 /
// 2026/11/23,勤労感謝の日 / 2027/1/1,元日 / 2027/1/11,成人の日 / 2027/5/3,憲法記念日
const CSV_SJIS_BASE64 =
  'jZGWr4LMj2qT+oFFi3iT+oyOk/osjZGWr4LMj2qT+oFFi3iT+pa8j8wNCjIwMTkvMS8xLIyzk/oNCjIwMjYvMS8xLIyzk/oNCjIwMjYvMTEvMyyVtom7gsyT+g0KMjAyNi8xMS8yMyyLzphKirSO04LMk/oNCjIwMjcvMS8xLIyzk/oNCjIwMjcvMS8xMSyQrJBsgsyT+g0KMjAyNy81LzMsjJuWQItMlE+T+g0K';
const csvBytes = () => Uint8Array.from(atob(CSV_SJIS_BASE64), (ch) => ch.charCodeAt(0));

const NOW = '2026-10-28T01:00:00Z';

function mockCsv(status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url !== HOLIDAY_CSV_URL) return new Response('not found', { status: 404 });
    return status === 200
      ? new Response(csvBytes(), { headers: { 'content-type': 'text/csv' } })
      : new Response('error', { status });
  });
}

async function cookieOf(role: 'staff' | 'admin' | 'developer') {
  await createStaff(`${role}@example.com`, role);
  return login(`${role}@example.com`);
}
const calendarRow = (date: string) =>
  env.DB.prepare('SELECT weekday, holiday_name, day_type, is_closed FROM calendar WHERE date = ?').bind(date).first();
const lastJob = () =>
  env.DB.prepare("SELECT status, message FROM system_jobs WHERE name = 'holidays' ORDER BY id DESC").first<{ status: string; message: string }>();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('B-02 祝日の取り込み', () => {
  it('CSV の日付と名前を読む(ゼロ埋めのない日付をそろえる)', () => {
    expect(parseHolidayCsv('国民の祝日・休日月日,国民の祝日・休日名称\r\n2026/1/1,元日\r\n2026/11/23,勤労感謝の日\r\n\r\n')).toEqual([
      { date: '2026-01-01', name: '元日' },
      { date: '2026-11-23', name: '勤労感謝の日' },
    ]);
  });

  it('管理者が手動で取り込むと、Shift_JIS の CSV を読んで calendar に祝日名と曜日区分を入れる', async () => {
    const fetchSpy = mockCsv();
    const admin = await cookieOf('admin');
    const res = await adminCall('/admin/api/holidays/import', { cookie: admin, body: {}, now: NOW });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.message).toContain('6件');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    expect(await calendarRow('2026-11-03')).toEqual({ weekday: 2, holiday_name: '文化の日', day_type: 'holiday', is_closed: 0 });
    expect(await calendarRow('2027-01-11')).toEqual({ weekday: 1, holiday_name: '成人の日', day_type: 'holiday', is_closed: 0 });
    // 5年より前(2019年)は取り込まない
    expect(await calendarRow('2019-01-01')).toBeNull();
    // 結果が記録され、操作ログにも残る
    expect(await lastJob()).toMatchObject({ status: 'ok' });
    const log = await env.DB.prepare("SELECT action, actor_id FROM audit_log WHERE action = 'system.holidays_import'").first();
    expect(log).toEqual({ action: 'system.holidays_import', actor_id: 1 });
  });

  it('臨時休業の印は変えず、CSV から消えた祝日は平日に戻す', async () => {
    mockCsv();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO calendar (date, weekday, holiday_name, day_type, is_closed, updated_at) VALUES ('2026-11-03', 2, NULL, 'weekday', 1, 'x')",
      ),
      env.DB.prepare(
        "INSERT INTO calendar (date, weekday, holiday_name, day_type, is_closed, updated_at) VALUES ('2026-07-20', 1, '海の日(旧)', 'holiday', 0, 'x')",
      ),
    ]);
    const admin = await cookieOf('admin');
    await adminCall('/admin/api/holidays/import', { cookie: admin, body: {}, now: NOW });
    expect(await calendarRow('2026-11-03')).toEqual({ weekday: 2, holiday_name: '文化の日', day_type: 'holiday', is_closed: 1 });
    expect(await calendarRow('2026-07-20')).toEqual({ weekday: 1, holiday_name: null, day_type: 'weekday', is_closed: 0 });
  });

  it('翌年の祝日がまだ載っていないときは「一部だけ」として記録する', async () => {
    mockCsv();
    await createStaff('admin@example.com', 'admin');
    const admin = await login('admin@example.com', 'password-1234', '2027-02-01T00:00:00Z');
    // 2027年の時点では、2028年の祝日が載っていない
    const res = await adminCall('/admin/api/holidays/import', { cookie: admin, body: {}, now: '2027-02-01T00:00:00Z' });
    expect(res.body.status).toBe('warning');
    expect(res.body.message).toContain('2028年の祝日はまだ公表されていませんでした');
  });

  it('取り込めなかったときは失敗として記録し、データは変えない', async () => {
    mockCsv(503);
    const admin = await cookieOf('admin');
    const res = await adminCall('/admin/api/holidays/import', { cookie: admin, body: {}, now: NOW });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('failed');
    expect(res.body.message).toContain('応答 503');
    expect(await lastJob()).toMatchObject({ status: 'failed' });
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM calendar').first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it('受付スタッフと製作者は取り込めない', async () => {
    const fetchSpy = mockCsv();
    const staff = await cookieOf('staff');
    expect((await adminCall('/admin/api/holidays/import', { cookie: staff, body: {}, now: NOW })).status).toBe(403);
    const dev = await cookieOf('developer');
    expect((await adminCall('/admin/api/holidays/import', { cookie: dev, body: {}, now: NOW })).status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('毎晩の処理では、2月1日と、まだ取り込めていないときだけ取り込む', async () => {
    const fetchSpy = mockCsv();
    const nightly = (jstDate: string) => {
      const d = new Date(`${jstDate}T03:10:00+09:00`);
      return runScheduled('10 18 * * *', env, d);
    };
    // 一度も取り込んでいない → 取り込む
    await nightly('2026-10-28');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // 取り込めた翌日 → 取り込まない
    await nightly('2026-10-29');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // 2月1日 → 取り込む(2028年の分はまだ無いので warning)
    await nightly('2027-02-01');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(await lastJob()).toMatchObject({ status: 'warning' });
    // warning のあとは1週間ごとにやり直す
    await nightly('2027-02-05');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await nightly('2027-02-08');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('失敗した翌晩は、取り込み直す', async () => {
    const failing = mockCsv(500);
    await runScheduled('10 18 * * *', env, new Date('2026-10-28T03:10:00+09:00'));
    expect(await lastJob()).toMatchObject({ status: 'failed' });
    failing.mockRestore();
    const ok = mockCsv();
    await runScheduled('10 18 * * *', env, new Date('2026-10-29T03:10:00+09:00'));
    expect(ok).toHaveBeenCalledTimes(1);
    expect(await lastJob()).toMatchObject({ status: 'ok' });
  });
});
