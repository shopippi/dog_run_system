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
