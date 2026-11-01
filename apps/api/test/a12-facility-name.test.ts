import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { adminCall, call, createStaff, login } from './helpers';

// 施設の名前(設定 facility_name。docs/changes-2026-10-28.md 1章)。
// 画面の「○○ 会員証」「○○ 受付・管理」に出す。ログインの前でも読めるよう、施設の名前だけを認証なしで返す。

describe('設定 施設の名前', () => {
  it('初期値は「グリーンドーム」。お客さん向けと管理画面向けの両方から、認証なしで施設の名前だけを読める', async () => {
    const customer = await call('/api/public-settings');
    expect(customer.status).toBe(200);
    expect(customer.body).toEqual({ facilityName: 'グリーンドーム' });
    const admin = await adminCall('/admin/api/public-settings', { noAdminHeader: true });
    expect(admin.status).toBe(200);
    expect(admin.body).toEqual({ facilityName: 'グリーンドーム' });
  });

  it('管理者がルールの設定で変えると、画面の名前が変わる。1〜30文字。操作ログに残る', async () => {
    await createStaff('admin@example.com', 'admin');
    const cookie = await login('admin@example.com');
    const before = await adminCall('/admin/api/settings', { cookie });
    expect(before.body.settings.facility_name).toBe('グリーンドーム');

    const ok = await adminCall('/admin/api/settings', { cookie, method: 'PATCH', body: { facility_name: '  みどりの森ドッグラン  ' } });
    expect(ok.status).toBe(200);
    expect(ok.body.settings.facility_name).toBe('みどりの森ドッグラン');
    expect((await call('/api/public-settings')).body).toEqual({ facilityName: 'みどりの森ドッグラン' });

    for (const bad of ['', '   ', 'あ'.repeat(31)]) {
      const res = await adminCall('/admin/api/settings', { cookie, method: 'PATCH', body: { facility_name: bad } });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('「施設の名前」は、1〜30文字で入れてください。');
    }
    expect((await adminCall('/admin/api/settings', { cookie, method: 'PATCH', body: { facility_name: 'あ'.repeat(30) } })).status).toBe(200);

    const { results } = await env.DB.prepare("SELECT target_id, after_value FROM audit_log WHERE action = 'settings.update'").all<{
      target_id: string;
      after_value: string;
    }>();
    expect(results).toHaveLength(2);
    expect(results[0]!.target_id).toBe('facility_name');
    expect(JSON.parse(results[0]!.after_value)).toEqual({ facility_name: 'みどりの森ドッグラン' });
  });

  it('受付と製作者は変えられない(製作者は 403)', async () => {
    await createStaff('staff@example.com', 'staff');
    await createStaff('dev@example.com', 'developer');
    for (const email of ['staff@example.com', 'dev@example.com']) {
      const cookie = await login(email);
      const res = await adminCall('/admin/api/settings', { cookie, method: 'PATCH', body: { facility_name: 'ちがう名前' } });
      expect(res.status).toBe(403);
    }
    expect((await call('/api/public-settings')).body).toEqual({ facilityName: 'グリーンドーム' });
  });
});
