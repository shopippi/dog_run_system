import { env } from 'cloudflare:test';
import { AUDIT_ACTION_LABELS, toJstDate } from '@dr/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runHolidaysJob, runWeatherJob } from '../src/cron';
import type { Bindings } from '../src/env';
import { resolveTargets } from '../src/services/audit-view';
import { addFamily, adminCall, call, checkin, createStaff, dog, login, registerUser } from './helpers';

// 検証で見つかった不備の修正(操作ログの言葉、統合を元に戻せる期間、日ごとの集計の更新、自動処理の文、設定の文)

const PAPA = 'U001:パパ';
const MAMA = 'U002:ママ';
const NOW = '2026-10-28T03:00:00Z';

async function cookieOf(role: 'staff' | 'admin' | 'developer' = 'admin') {
  await createStaff(`${role}@example.com`, role);
  return login(`${role}@example.com`);
}
async function householdIdOf(memberNo: string) {
  const r = await env.DB.prepare('SELECT id FROM households WHERE member_no = ?').bind(memberNo).first<{ id: number }>();
  return r!.id;
}
const stats = (date: string) =>
  env.DB.prepare('SELECT visit_groups, new_households, first_visit_households FROM daily_stats WHERE date = ?')
    .bind(date)
    .first<{ visit_groups: number; new_households: number; first_visit_households: number }>();

afterEach(() => vi.restoreAllMocks());

describe('操作ログの言葉', () => {
  it('API で記録するすべての操作の種類に、日本語の言葉がある', () => {
    const actions = [
      'audit.undo', 'breed.create', 'breed.reorder', 'breed.update', 'closure.create', 'closure.delete',
      'dog.photo', 'dog.photo_remove', 'dog.photo_rotate', 'dog.update', 'event.create', 'event.delete',
      'expiry.run', 'export.csv', 'family.invite', 'family.leave', 'family.remove', 'household.merge',
      'household.merge_undo', 'household.migrate', 'household.migrate_undo', 'household.rename',
      'migration_images.delete', 'points.manual', 'request.reject', 'settings.update', 'staff.create',
      'staff.password_reset', 'staff.status', 'survey_question.create', 'survey_question.reorder',
      'survey_question.update', 'system.backup', 'system.holidays_import', 'system.run.weather',
      'system.run.holidays', 'system.run.backup', 'system.run.daily_stats', 'visit.cancel', 'visit.proxy', 'visit.walkin',
    ];
    for (const a of actions) expect(AUDIT_ACTION_LABELS[a], a).toMatch(/[ぁ-んァ-ヶ一-龠]/);
  });

  it('対象の種類も日本語で出す(臨時休業日は日付つき)', async () => {
    const types = ['calendar', 'export', 'system', 'request', 'settings', 'breed', 'survey_question', 'staff', 'event', 'merge'];
    const out = await resolveTargets(env.DB, [...types.map((type) => ({ type, id: 'x' })), { type: 'calendar', id: '2026-11-03' }]);
    for (const type of types) expect(out.get(`${type}:x`)!.label, type).not.toBe('—');
    expect(out.get('calendar:2026-11-03')!.label).toBe('11月3日(臨時休業日)');
  });

  it('家族が自分で抜けたときの操作ログは、対象の番号が整数の文字列になる', async () => {
    const r = await registerUser(PAPA);
    await addFamily(r.memberNo, 'U002', 'ママ');
    expect((await call('/api/family/leave', { user: MAMA, method: 'POST', now: NOW })).status).toBe(200);
    const log = await env.DB.prepare("SELECT target_id FROM audit_log WHERE action = 'family.leave'").first<{ target_id: string }>();
    expect(log!.target_id).toMatch(/^\d+$/);
    const admin = await cookieOf();
    const res = await adminCall('/admin/api/audit', { cookie: admin, now: NOW });
    expect(res.body.entries[0]).toMatchObject({ actionLabel: '家族が自分でおうちから抜けた', target: { label: 'ママさん(アルのおうち)' } });
  });
});

describe('統合を元に戻せるのは30日以内で、まだ戻していないときだけ', () => {
  async function mergeLog(executedAt: string, undoneAt: string | null = null) {
    await env.DB.prepare(
      `INSERT INTO audit_log (actor_type, actor_id, action, target_type, target_id, created_at, undone_at)
       VALUES ('staff', 1, 'household.merge', 'merge', '1', ?, ?)`,
    )
      .bind(executedAt, undoneAt)
      .run();
  }

  it('操作ログの「元に戻す」は、30日を過ぎると出さない', async () => {
    const admin = await cookieOf();
    await mergeLog('2026-10-01T12:00:00+09:00');
    const within = await adminCall('/admin/api/audit', { cookie: admin, now: '2026-10-31T02:00:00Z' });
    expect(within.body.entries[0].canUndo).toBe(true);
    const after = await adminCall('/admin/api/audit', { cookie: admin, now: '2026-10-31T04:00:00Z' });
    expect(after.body.entries[0].canUndo).toBe(false);
  });

  it('元に戻した統合には「元に戻す」を出さない', async () => {
    const admin = await cookieOf();
    await mergeLog('2026-10-27T12:00:00+09:00', '2026-10-28T09:00:00+09:00');
    const res = await adminCall('/admin/api/audit', { cookie: admin, now: NOW });
    expect(res.body.entries[0]).toMatchObject({ canUndo: false, undone: { at: '2026-10-28T09:00:00+09:00' } });
  });
});

describe('日ごとの集計を、登録・取り消しを元に戻す・統合・統合を元に戻すのあとにも作り直す', () => {
  it('新規登録で、その日の新しいおうちの数が増える', async () => {
    await registerUser(PAPA);
    expect((await stats(toJstDate(new Date())))?.new_households).toBe(1);
  });

  it('チェックインの取り消しを操作ログから元に戻すと、来場組数が戻る', async () => {
    await createStaff('staff@example.com', 'staff');
    const staff = await login('staff@example.com');
    const admin = await cookieOf();
    const r = await registerUser(PAPA);
    const v = await checkin(PAPA, [r.dogs[0]!.id], { now: NOW });
    await adminCall(`/admin/api/checkins/${v.body.visitId}/cancel`, { cookie: staff, body: { reason: '入力ミス' }, now: NOW });
    expect((await stats('2026-10-28'))?.visit_groups).toBe(0);
    const log = await env.DB.prepare("SELECT id FROM audit_log WHERE action = 'visit.cancel'").first<{ id: number }>();
    expect((await adminCall(`/admin/api/audit/${log!.id}/undo`, { cookie: admin, body: {}, now: NOW })).status).toBe(200);
    expect((await stats('2026-10-28'))?.visit_groups).toBe(1);
  });

  it('統合すると、まとめた側の初来場が数えられなくなり、元に戻すと元の数に戻る', async () => {
    const admin = await cookieOf();
    const papa = await registerUser(PAPA, [dog('アル')]);
    const mama = await registerUser(MAMA, [dog('モカ')]);
    await checkin(PAPA, [papa.dogs[0]!.id], { now: '2026-10-01T01:00:00Z' });
    await checkin(MAMA, [mama.dogs[0]!.id], { now: '2026-10-02T01:00:00Z' });
    expect((await stats('2026-10-02'))?.first_visit_households).toBe(1);

    const input = { keepHouseholdId: await householdIdOf(papa.memberNo), absorbHouseholdId: await householdIdOf(mama.memberNo), dogPairs: [] };
    const res = await adminCall('/admin/api/merges', { cookie: admin, body: input, now: NOW });
    expect(res.status).toBe(201);
    expect((await stats('2026-10-02'))?.first_visit_households).toBe(0);

    expect((await adminCall(`/admin/api/merges/${res.body.mergeId}/undo`, { cookie: admin, body: {}, now: NOW })).status).toBe(200);
    expect((await stats('2026-10-02'))?.first_visit_households).toBe(1);
  });
});

describe('自動処理の結果は日本語だけを画面に出す', () => {
  const offline = () => ({ ...(env as unknown as Bindings), OFFLINE: '1' }) as Bindings;

  it('つながらないときは「何が起きたか」を日本語で残し、元の例外の文は detail に分ける', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed: getaddrinfo ENOTFOUND'));
    const result = await runHolidaysJob(env as unknown as Bindings, new Date(NOW));
    expect(result.status).toBe('failed');
    expect(result.message).toBe('祝日の取得先(内閣府のサイト)につながりませんでした。少し待ってから、もう一度お試しください。');
    expect(result.detail).toContain('ENOTFOUND');

    await createStaff('developer@example.com', 'developer');
    const dev = await login('developer@example.com');
    const status = await adminCall('/admin/api/system-status', { cookie: dev, now: NOW });
    const job = status.body.jobs.find((j: { name: string }) => j.name === 'holidays');
    expect(job.lastRun.message).toBe(result.message);
    // 製作者の詳細には、元の例外の文も返す(画面には出さない)
    expect(status.body.detail.recentFailures[0].detail).toContain('ENOTFOUND');
  });

  it('インターネットにつながらない環境(OFFLINE)では、天気・祝日の取得をスキップして成功にする', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const w = await runWeatherJob(offline(), new Date(NOW));
    const h = await runHolidaysJob(offline(), new Date(NOW));
    expect(w).toEqual({ status: 'ok', message: 'スキップしました(インターネットにつながらない環境のため)。' });
    expect(h).toEqual({ status: 'ok', message: 'スキップしました(インターネットにつながらない環境のため)。' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('設定とスタッフの言葉', () => {
  it('LINEミニアプリの番号の形がちがうときは、入れ方を日本語で返す', async () => {
    const admin = await cookieOf();
    const res = await adminCall('/admin/api/settings', { cookie: admin, method: 'PATCH', body: { liff_id: 'abc def' } });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(
      '「LINEミニアプリの番号」は、「1234567890-AbCdEfGh」のような形(数字・ハイフン・英数字)で入れてください。製作者から伝えられた番号をそのまま貼り付けてください。',
    );
  });

  it('パスワードを5回まちがえたスタッフは、解除までの分を返す', async () => {
    const admin = await cookieOf();
    await createStaff('staff@example.com', 'staff');
    await env.DB.prepare("UPDATE staff_users SET locked_until = '2026-10-28T12:10:00+09:00' WHERE email = 'staff@example.com'").run();
    const res = await adminCall('/admin/api/staff', { cookie: admin, now: NOW });
    const s = res.body.staff.find((x: { email: string }) => x.email === 'staff@example.com');
    expect(s).toMatchObject({ locked: true, lockedMinutes: 10 });
  });
});
