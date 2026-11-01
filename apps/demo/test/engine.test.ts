import initSqlJs from 'sql.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { DemoEngine } from '../src/engine/engine';
import { DEMO_PASSWORD, FIXED } from '../src/seed/fixtures';

// 2026-10-28(水)12:00(日本時間)
const NOW = Date.parse('2026-10-28T03:00:00Z');
let engine: DemoEngine;

const lineHeaders = (userId: string, name: string): [string, string][] => [
  ['authorization', `Bearer mock:${userId}:${encodeURIComponent(name)}`],
  ['content-type', 'application/json'],
];

async function customer<T>(userId: string, name: string, method: string, url: string, body?: unknown) {
  const res = await engine.handle(
    {
      method,
      url,
      headers: lineHeaders(userId, name),
      body: body === undefined ? null : (new TextEncoder().encode(JSON.stringify(body)).buffer as ArrayBuffer),
    },
    'liff',
  );
  return { status: res.status, data: JSON.parse(new TextDecoder().decode(res.body ?? new ArrayBuffer(0)) || 'null') as T };
}

beforeAll(async () => {
  engine = await DemoEngine.create({ SQL: await initSqlJs(), memoryOnly: true, clock: () => NOW });
});

describe('初期データ', () => {
  it('おうち30件・来場およそ600件ができる。確認待ちの申請はない', () => {
    const one = (q: string) => Object.values(engine.select(q)[0]!)[0] as number;
    expect(one("SELECT COUNT(*) FROM households WHERE status = 'active'")).toBe(30);
    const visits = one('SELECT COUNT(*) FROM visits WHERE household_id IS NOT NULL');
    expect(visits).toBeGreaterThan(450);
    expect(visits).toBeLessThan(750);
    expect(one('SELECT COUNT(*) FROM visits WHERE household_id IS NULL')).toBeGreaterThan(10);
    expect(one("SELECT COUNT(*) FROM requests WHERE status = 'pending'")).toBe(0);
    expect(one("SELECT COUNT(*) FROM requests WHERE kind = 'migration'")).toBe(0);
    expect(one('SELECT COUNT(*) FROM family_members GROUP BY household_id HAVING COUNT(*) = 2 LIMIT 1')).toBe(2);
    expect(one('SELECT COUNT(*) FROM (SELECT household_id FROM family_members GROUP BY household_id HAVING COUNT(*) = 2)')).toBe(5);
    expect(one('SELECT COUNT(*) FROM events')).toBe(4);
    expect(one('SELECT COUNT(*) FROM calendar WHERE is_closed = 1')).toBe(2);
    expect(one("SELECT COUNT(*) FROM calendar WHERE holiday_name IS NOT NULL AND date LIKE '2026-%'")).toBeGreaterThan(5);
  });

  it('ポイントと無料券が台帳と矛盾しない(10たまったら交換している。交換した券と台帳の行が同じ数。使った券は来場に結びつく)', () => {
    const bad = engine.select(
      `SELECT h.id, COALESCE((SELECT SUM(delta) FROM point_ledger p WHERE p.household_id = h.id), 0) AS bal FROM households h`,
    );
    for (const r of bad) expect(Number(r.bal)).toBeGreaterThanOrEqual(0), expect(Number(r.bal)).toBeLessThan(10);
    const issued = engine.select<{ n: number }>("SELECT COUNT(*) AS n FROM tickets WHERE source = 'points'")[0]!.n;
    const rows = engine.select<{ n: number }>("SELECT COUNT(*) AS n FROM point_ledger WHERE kind = 'ticket_issue'")[0]!.n;
    expect(issued).toBe(rows);
    const exchanges = engine.select<{ n: number }>(
      "SELECT COUNT(*) AS n FROM point_ledger WHERE kind = 'ticket_issue' AND actor_type = 'member' AND visit_id IS NULL AND op_id LIKE 'exchange:%'",
    )[0]!.n;
    expect(exchanges).toBe(rows);
    const used = engine.select<{ n: number }>("SELECT COUNT(*) AS n FROM tickets WHERE status = 'used'")[0]!.n;
    const usedLinked = engine.select<{ n: number }>("SELECT COUNT(*) AS n FROM tickets WHERE status = 'used' AND used_visit_id IS NOT NULL")[0]!.n;
    expect(used).toBe(usedLinked);
    expect(used).toBeGreaterThan(0);
  });
});

describe('ブラウザの中の API', () => {
  it('こむぎママは9ポイント。チェックインすると10ポイントになり、会員証で無料券と交換できる', async () => {
    const me = await customer<{ registered: boolean; card: { balance: number } }>('U-demo-mama', 'こむぎママ', 'GET', '/api/me');
    expect(me.status).toBe(200);
    expect(me.data.registered).toBe(true);
    expect(me.data.card.balance).toBe(9);

    const status = await customer<{ dogs: { id: number }[] }>('U-demo-mama', 'こむぎママ', 'GET', '/api/checkins/today');
    const res = await customer<{ balanceAfter: number }>('U-demo-mama', 'こむぎママ', 'POST', '/api/checkins', {
      passphrase: engine.passphrase(),
      dogIds: [status.data.dogs[0]!.id],
    });
    expect(res.status).toBe(201);
    expect(res.data.balanceAfter).toBe(10);
    const ex = await customer<{ balance: number; unusedTickets: number }>('U-demo-mama', 'こむぎママ', 'POST', '/api/tickets/exchange', {});
    expect(ex.status).toBe(201);
    expect(ex.data.balance).toBe(0);

    // 同じ日に家族(ばあば)がもう一度チェックインしても、ポイントは増えない
    const again = await customer<{ error: { code: string } }>('U-demo-baaba', 'こむぎのばあば', 'POST', '/api/checkins', {
      passphrase: engine.passphrase(),
      dogIds: [status.data.dogs[1]!.id],
    });
    expect(again.status).toBe(409);
    expect(again.data.error.code).toBe('already_checked_in');
  });

  it('はじめての人は未登録として返る', async () => {
    const me = await customer<{ registered: boolean }>('U-demo-new-1', 'はじめての人', 'GET', '/api/me');
    expect(me.status).toBe(200);
    expect(me.data.registered).toBe(false);
  });

  it('管理画面: ログインのクッキーを画面ごとに保ち、今日の来場が見える', async () => {
    expect(await engine.loginAs('admin', 'admin@example.com', DEMO_PASSWORD)).toBe(true);
    const me = await engine.call<{ role: string }>('admin', 'GET', '/admin/api/me');
    expect(me.status).toBe(200);
    expect(me.data.role).toBe('admin');
    // 別の画面の入れ物にはクッキーがない
    expect((await engine.call('other', 'GET', '/admin/api/me')).status).toBe(401);
    const pending = await engine.call<{ pending: number }>('admin', 'GET', '/admin/api/requests/count');
    expect(pending.data.pending).toBe(0);

    // 製作者は見るだけ
    expect(await engine.loginAs('admin', 'developer@example.com', DEMO_PASSWORD)).toBe(true);
    const walkin = await engine.call('admin', 'POST', '/admin/api/walkins', { dogCount: 1 });
    expect(walkin.status).toBe(403);
    expect(await engine.loginAs('admin', 'admin@example.com', 'wrong-password')).toBe(false);
  });

  it('「翌日にする」で日付が進み、同じおうちがもう一度チェックインできる', async () => {
    const before = engine.today();
    await engine.advanceDay();
    expect(engine.today() > before).toBe(true);
    const status = await customer<{ dogs: { id: number }[]; visit: unknown }>('U-demo-mama', 'こむぎママ', 'GET', '/api/checkins/today');
    expect(status.data.visit).toBeNull();
    const me = await customer<{ card: { tickets: { id: number }[] } }>('U-demo-mama', 'こむぎママ', 'GET', '/api/me');
    const used = await customer<{ isToday: boolean }>('U-demo-mama', 'こむぎママ', 'POST', `/api/tickets/${me.data.card.tickets[0]!.id}/use`, {});
    expect(used.status).toBe(200);
    expect(used.data.isToday).toBe(true);
    const res = await customer<{ balanceAfter: number; usedTicket: boolean }>('U-demo-mama', 'こむぎママ', 'POST', '/api/checkins', {
      passphrase: engine.passphrase(),
      dogIds: [status.data.dogs[0]!.id],
    });
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({ balanceAfter: 1, usedTicket: true });
    await engine.runNightly();
  });

  it('固定のおうちの番号', () => {
    const rows = engine.select<{ id: number; display_name: string }>('SELECT id, display_name FROM households WHERE id <= 4 ORDER BY id');
    expect(rows.map((r) => r.display_name)).toEqual(['こむぎ・だいずのおうち', 'アルのおうち', 'アル・ニコのおうち', 'もものおうち']);
    expect(FIXED.komugi).toBe(1);
  });
});

describe('預かり・お泊まりの予約(21章)', () => {
  const one = (q: string, p: unknown[] = []) => Object.values(engine.select(q, p)[0]!)[0] as number;

  it('およそ1か月分の予約があり、どの日も受け入れ数(小型5・中型3・大型2)を超えない。満員の日と休みの日がある', () => {
    expect(one('SELECT COUNT(*) FROM bookings')).toBeGreaterThan(25);
    expect(one("SELECT COUNT(*) FROM bookings WHERE status = 'pending'")).toBeGreaterThan(0);
    expect(one("SELECT COUNT(*) FROM bookings WHERE status = 'completed'")).toBeGreaterThan(5);
    expect(one('SELECT COUNT(*) FROM booking_capacity_overrides WHERE closed = 1')).toBe(1);
    const rows = engine.select<{ service: string; occupy_from: string; occupy_to: string; size: string }>(
      `SELECT b.service, b.occupy_from, b.occupy_to, bd.size FROM booking_dogs bd JOIN bookings b ON b.id = bd.booking_id
        WHERE b.status IN ('pending', 'confirmed', 'checked_in', 'completed')`,
    );
    const caps: Record<string, number> = { small: 5, medium: 3, large: 2 };
    const used = new Map<string, number>();
    for (const r of rows) {
      for (let d = r.occupy_from; d <= r.occupy_to; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)) {
        const k = `${r.service}:${d}:${r.size}`;
        used.set(k, (used.get(k) ?? 0) + 1);
      }
    }
    for (const [k, n] of used) expect(n, k).toBeLessThanOrEqual(caps[k.split(':')[2]!]!);
    expect([...used.values()].some((n) => n === 3)).toBe(true);
  });

  it('こむぎだけならすぐ確定、だいず(はじめて)がいると確認待ち → 管理者が承認すると確定になり、LINE のお知らせ(送ったつもり)が残る', async () => {
    const mama = (m: string, u: string, b?: unknown) => customer<any>('U-demo-mama', 'こむぎママ', m, u, b);
    const opts = await mama('GET', '/api/bookings/options');
    expect(opts.status).toBe(200);
    const komugi = opts.data.dogs.find((d: { name: string }) => d.name === 'こむぎ');
    const daizu = opts.data.dogs.find((d: { name: string }) => d.name === 'だいず');
    expect(komugi.experienced).toBe(true);
    expect(daizu.experienced).toBe(false);
    // 満員(中型)の日は、だいずを選ぶと選べない
    const av = await mama('GET', `/api/bookings/availability?service=daycare&from=2026-11-03&to=2026-11-06&dogIds=${daizu.id}`);
    expect(av.data.days.find((d: { date: string }) => d.date === '2026-11-03').status).toBe('full');
    expect(av.data.days.find((d: { date: string }) => d.date === '2026-11-06').status).toBe('closed');

    const body = (dogIds: number[], date: string) => ({
      service: 'daycare', startDate: date, endDate: date, startTime: '10:00', endTime: '16:00', dogIds, checklist: opts.data.rules.booking_checklist,
    });
    const quick = await mama('POST', '/api/bookings', body([komugi.id], '2026-11-02'));
    expect(quick.status).toBe(201);
    expect(quick.data.status).toBe('confirmed');
    const first = await mama('POST', '/api/bookings', body([daizu.id], '2026-11-02'));
    expect(first.data.status).toBe('pending');

    await engine.loginAs('admin', 'admin@example.com', DEMO_PASSWORD);
    const ok = await engine.call<any>('admin', 'POST', `/admin/api/bookings/${first.data.id}/approve`, { message: 'お待ちしています' });
    expect(ok.status).toBe(200);
    expect(ok.data.booking.status).toBe('confirmed');
    expect(ok.data.booking.notifications[0]).toMatchObject({ status: 'sent', reason: 'mock' });
    const mine = await mama('GET', `/api/bookings/${first.data.id}`);
    expect(mine.data.status).toBe('confirmed');
    expect(one("SELECT COUNT(*) FROM booking_notifications n JOIN family_members m ON m.id = n.member_id WHERE m.line_user_id = 'U-demo-mama'")).toBeGreaterThanOrEqual(3);
  });
});
