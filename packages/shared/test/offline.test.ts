import { describe, expect, it } from 'vitest';
import { CLIENT_TIME_WINDOW_MINUTES, IDEMPOTENCY_KEY_RE, resolveCheckinTime, toJstIso } from '../src';

// 電波が弱いときのチェックインの時刻(要件定義書 15.3)
const server = new Date('2026-10-30T10:00:00+09:00');
const min = 60_000;

describe('押した時刻の扱い(resolveCheckinTime)', () => {
  it('値がないときは、サーバーの時刻', () => {
    expect(resolveCheckinTime({ serverNow: server })).toEqual({ at: server, source: 'server' });
    expect(resolveCheckinTime({ serverNow: server, pressedAt: 1, clientNow: null }).source).toBe('server');
  });

  it('押してから10分後に送れたときは、サーバーの時刻から10分さかのぼる', () => {
    const r = resolveCheckinTime({ serverNow: server, pressedAt: 1_000_000, clientNow: 1_000_000 + 10 * min });
    expect(r.source).toBe('client');
    expect(toJstIso(r.at)).toBe('2026-10-30T09:50:00+09:00');
  });

  it('スマホの時計が何時間ずれていても、差だけを使う', () => {
    const wrongClock = new Date('2020-01-01T03:00:00Z').getTime();
    const r = resolveCheckinTime({ serverNow: server, pressedAt: wrongClock, clientNow: wrongClock + 5 * min });
    expect(toJstIso(r.at)).toBe('2026-10-30T09:55:00+09:00');
  });

  it('30分ちょうどまでは信じ、30分を超えたらサーバーの時刻', () => {
    const ok = resolveCheckinTime({ serverNow: server, pressedAt: 0 + 1, clientNow: CLIENT_TIME_WINDOW_MINUTES * min + 1 });
    expect(ok.source).toBe('client');
    const late = resolveCheckinTime({ serverNow: server, pressedAt: 1, clientNow: CLIENT_TIME_WINDOW_MINUTES * min + 2 });
    expect(late).toEqual({ at: server, source: 'server' });
  });

  it('差がマイナス(時計を戻した)ときは、サーバーの時刻', () => {
    expect(resolveCheckinTime({ serverNow: server, pressedAt: 10 * min, clientNow: 5 * min }).source).toBe('server');
  });

  it('1秒未満の差(ふつうに送れたとき)は、サーバーの時刻', () => {
    expect(resolveCheckinTime({ serverNow: server, pressedAt: 1000, clientNow: 1500 }).source).toBe('server');
  });

  it('さかのぼると前の日(日本時間)になるときは、サーバーの時刻', () => {
    const justAfterMidnight = new Date('2026-10-31T00:05:00+09:00');
    const r = resolveCheckinTime({ serverNow: justAfterMidnight, pressedAt: 1, clientNow: 1 + 10 * min });
    expect(r).toEqual({ at: justAfterMidnight, source: 'server' });
    // 同じ日の中なら使う
    const r2 = resolveCheckinTime({ serverNow: justAfterMidnight, pressedAt: 1, clientNow: 1 + 4 * min });
    expect(toJstIso(r2.at)).toBe('2026-10-31T00:01:00+09:00');
  });

  it('数でない値は、サーバーの時刻', () => {
    expect(resolveCheckinTime({ serverNow: server, pressedAt: Number.NaN, clientNow: 5 }).source).toBe('server');
    expect(resolveCheckinTime({ serverNow: server, pressedAt: 1, clientNow: Number.POSITIVE_INFINITY }).source).toBe('server');
  });
});

describe('送信の印', () => {
  it('UUID は使え、短すぎる・記号入りは使えない', () => {
    expect(IDEMPOTENCY_KEY_RE.test('3f2b8c1e-8a4d-4f7e-9c1b-2d3e4f5a6b7c')).toBe(true);
    expect(IDEMPOTENCY_KEY_RE.test('abc')).toBe(false);
    expect(IDEMPOTENCY_KEY_RE.test('abc def ghi')).toBe(false);
    expect(IDEMPOTENCY_KEY_RE.test("x'; DROP TABLE visits;--")).toBe(false);
  });
});
