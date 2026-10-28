import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { getUndo, type AuditRow } from '../src/services/undo';
import '../src/routes/admin/events';
import { adminCall, createStaff, login } from './helpers';

const NOW = '2026-10-28T01:00:00Z';
async function as(role: 'staff' | 'admin' | 'developer') {
  await createStaff(`${role}@example.com`, role);
  return login(`${role}@example.com`);
}
const lastLog = () => env.DB.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 1').first<AuditRow>();
const undo = async (action: string) => getUndo(action)!(env.DB, (await lastLog())!, { staffId: 1, now: new Date(NOW) });

describe('A-09 イベント・休業日', () => {
  it('イベントを追加すると、その月の一覧に出る。月を指定しなければ今月', async () => {
    const cookie = await as('admin');
    const res = await adminCall('/admin/api/events', {
      cookie,
      now: NOW,
      body: { date: '2026-11-03', name: ' ハロウィン撮影会 ', kind: 'イベント', memo: '仮装OK' },
    });
    expect(res.status).toBe(201);
    expect(res.body.event).toMatchObject({ date: '2026-11-03', name: 'ハロウィン撮影会', kind: 'イベント', memo: '仮装OK' });
    expect(await lastLog()).toMatchObject({ action: 'event.create', target_type: 'event', target_id: String(res.body.event.id) });

    await adminCall('/admin/api/events', { cookie, now: NOW, body: { date: '2026-10-31', name: 'しつけ教室', kind: '教室・講習' } });
    const nov = await adminCall('/admin/api/events?month=2026-11', { cookie, now: NOW });
    expect(nov.body).toMatchObject({ month: '2026-11', events: [{ name: 'ハロウィン撮影会' }] });
    const current = await adminCall('/admin/api/events', { cookie, now: NOW });
    expect(current.body).toMatchObject({ month: '2026-10', events: [{ name: 'しつけ教室', kind: '教室・講習', memo: null }] });
  });

  it('入力のチェック: 日付の形・名前は50文字まで(境界値)・種類', async () => {
    const cookie = await as('admin');
    const post = (body: Record<string, unknown>) => adminCall('/admin/api/events', { cookie, now: NOW, body });
    expect((await post({ date: '2026-02-30x', name: 'A' })).body.error.message).toBe('日付を選び直してください。');
    expect((await post({ date: '2026-02-30', name: 'A' })).body.error.message).toBe('日付を選び直してください。');
    expect((await post({ date: '2026-12-01', name: 'あ'.repeat(50) })).status).toBe(201);
    expect((await post({ date: '2026-12-01', name: 'あ'.repeat(51) })).body.error.message).toBe('イベントの名前は50文字までで入力してください。');
    expect((await post({ date: '2026-12-01', name: 'A', kind: '運動会' })).body.error.message).toBe('種類を選んでください。');
    expect((await adminCall('/admin/api/events?month=2026-13', { cookie })).status).toBe(400);
  });

  it('イベントを消すと deleted_at が入り(行は残る)、一覧から消える。操作ログから元に戻せる', async () => {
    const cookie = await as('admin');
    const res = await adminCall('/admin/api/events', { cookie, now: NOW, body: { date: '2026-10-30', name: '貸し切り', kind: '貸し切り' } });
    const id = res.body.event.id;
    const del = await adminCall(`/admin/api/events/${id}`, { cookie, now: NOW, method: 'DELETE' });
    expect(del.status).toBe(200);
    const row = await env.DB.prepare('SELECT deleted_at FROM events WHERE id = ?').bind(id).first();
    expect(row).toEqual({ deleted_at: '2026-10-28T10:00:00+09:00' });
    expect((await adminCall('/admin/api/events?month=2026-10', { cookie })).body.events).toEqual([]);
    expect((await adminCall(`/admin/api/events/${id}`, { cookie, method: 'DELETE' })).status).toBe(404);

    await undo('event.delete');
    expect((await adminCall('/admin/api/events?month=2026-10', { cookie })).body.events).toHaveLength(1);
  });

  it('臨時休業日: 行がなければ曜日と曜日区分つきで作り、祝日名は変えない。やめると is_closed が 0 に戻る', async () => {
    const cookie = await as('admin');
    // 祝日の行(B-02 が入れたもの)
    await env.DB.prepare(
      `INSERT INTO calendar (date, weekday, holiday_name, day_type, is_closed, updated_at)
       VALUES ('2026-11-03', 2, '文化の日', 'holiday', 0, '2026-01-01T00:00:00+09:00')`,
    ).run();
    const a = await adminCall('/admin/api/closures', { cookie, now: NOW, body: { date: '2026-11-07', note: '芝の張り替え' } });
    expect(a.status).toBe(201);
    await adminCall('/admin/api/closures', { cookie, now: NOW, body: { date: '2026-11-03' } });
    const rows = await env.DB.prepare('SELECT * FROM calendar ORDER BY date').all();
    expect(rows.results).toEqual([
      expect.objectContaining({ date: '2026-11-03', weekday: 2, holiday_name: '文化の日', day_type: 'holiday', is_closed: 1, closed_note: null }),
      expect.objectContaining({ date: '2026-11-07', weekday: 6, holiday_name: null, day_type: 'saturday', is_closed: 1, closed_note: '芝の張り替え' }),
    ]);
    const list = await adminCall('/admin/api/closures?month=2026-11', { cookie });
    expect(list.body).toEqual({
      month: '2026-11',
      closures: [
        { date: '2026-11-03', note: null },
        { date: '2026-11-07', note: '芝の張り替え' },
      ],
      holidays: [{ date: '2026-11-03', name: '文化の日' }],
    });

    const del = await adminCall('/admin/api/closures/2026-11-03', { cookie, now: NOW, method: 'DELETE' });
    expect(del.status).toBe(200);
    const day = await env.DB.prepare("SELECT holiday_name, is_closed FROM calendar WHERE date = '2026-11-03'").first();
    expect(day).toEqual({ holiday_name: '文化の日', is_closed: 0 });
    expect((await adminCall('/admin/api/closures/2026-11-03', { cookie, method: 'DELETE' })).status).toBe(404);
    expect(await lastLog()).toMatchObject({ action: 'closure.delete', target_type: 'calendar', target_id: '2026-11-03' });

    // 元に戻す(休業日に戻る)
    await undo('closure.delete');
    expect((await adminCall('/admin/api/closures?month=2026-11', { cookie })).body.closures).toHaveLength(2);
  });

  it('臨時休業日の追加は、操作ログから元に戻せる(前の状態に戻る)', async () => {
    const cookie = await as('admin');
    await adminCall('/admin/api/closures', { cookie, now: NOW, body: { date: '2026-11-11', note: '雨' } });
    await adminCall('/admin/api/closures', { cookie, now: NOW, body: { date: '2026-11-11', note: '大雨' } });
    await undo('closure.create');
    expect((await adminCall('/admin/api/closures?month=2026-11', { cookie })).body.closures).toEqual([{ date: '2026-11-11', note: '雨' }]);
  });

  it('受付スタッフは 403。製作者は見られるが、変更は 403', async () => {
    const staff = await as('staff');
    expect((await adminCall('/admin/api/events', { cookie: staff })).status).toBe(403);
    expect((await adminCall('/admin/api/closures', { cookie: staff, body: { date: '2026-11-11' } })).status).toBe(403);
    const dev = await as('developer');
    expect((await adminCall('/admin/api/events', { cookie: dev })).status).toBe(200);
    expect((await adminCall('/admin/api/closures', { cookie: dev })).status).toBe(200);
    expect((await adminCall('/admin/api/events', { cookie: dev, body: { date: '2026-11-11', name: 'A' } })).status).toBe(403);
    expect((await adminCall('/admin/api/events/1', { cookie: dev, method: 'DELETE' })).status).toBe(403);
    expect((await adminCall('/admin/api/closures', { cookie: dev, body: { date: '2026-11-11' } })).status).toBe(403);
    expect((await adminCall('/admin/api/closures/2026-11-11', { cookie: dev, method: 'DELETE' })).status).toBe(403);
  });
});
