import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { loadSettings } from '../src/lib/settings';
import { call } from './helpers';

const T = '2026-10-28T10:00:00+09:00';

async function insertHousehold(id: number) {
  await env.DB.prepare(
    `INSERT INTO households (id, member_no, display_name, display_name_search, registered_at, updated_at)
     VALUES (?, ?, 'テストのおうち', 'てすとのおうち', ?, ?)`,
  )
    .bind(id, `DR-${String(id).padStart(6, '0')}`, T, T)
    .run();
}

describe('マイグレーション', () => {
  it('要件定義書 11章の21テーブルと、ログイン状態のテーブルがある', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY name",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual(
      [
        'audit_log',
        'breeds',
        'calendar',
        'daily_stats',
        'daily_weather',
        'dog_changes',
        'dogs',
        'events',
        'family_members',
        'households',
        'invites',
        'merges',
        'point_ledger',
        'requests',
        'settings',
        'staff_sessions',
        'staff_users',
        'survey_answers',
        'survey_questions',
        'system_jobs',
        'tickets',
        'visit_dogs',
        'visits',
      ].sort(),
    );
  });

  it('残高の列を持たない(残高は台帳から計算する)', async () => {
    const { results } = await env.DB.prepare("SELECT name FROM pragma_table_info('households')").all<{ name: string }>();
    const cols = results.map((r) => r.name);
    expect(cols.some((c) => /point|balance|ticket/.test(c))).toBe(false);
  });

  it('同じおうちの同じ日の来場は1件だけ。取り消し済みと会員以外は除く', async () => {
    await insertHousehold(1);
    const insertVisit = (householdId: number | null, cancelled: string | null) =>
      env.DB.prepare(
        `INSERT INTO visits (household_id, visit_date, checked_in_at, dog_count, method, cancelled_at)
         VALUES (?, '2026-10-28', ?, 1, ?, ?)`,
      )
        .bind(householdId, T, householdId ? 'self' : 'walkin', cancelled)
        .run();

    await insertVisit(1, T); // 取り消し済み
    await insertVisit(1, null);
    await expect(insertVisit(1, null)).rejects.toThrow(/UNIQUE/);
    await insertVisit(null, null);
    await insertVisit(null, null);
  });

  it('1つのLINEアカウントが同時に入れるおうちは1つ。抜けたあとは入り直せる', async () => {
    await insertHousehold(1);
    await insertHousehold(2);
    const addMember = (householdId: number, status: string) =>
      env.DB.prepare(
        `INSERT INTO family_members (household_id, line_user_id, joined_at, join_method, status, updated_at)
         VALUES (?, 'U123', ?, 'register', ?, ?)`,
      )
        .bind(householdId, T, status, T)
        .run();

    await addMember(1, 'left');
    await addMember(2, 'active');
    await expect(addMember(1, 'active')).rejects.toThrow(/UNIQUE/);
  });

  it('犬種の選択肢と、固定のアンケートが入っている', async () => {
    const breeds = await env.DB.prepare('SELECT COUNT(*) AS n FROM breeds').first<{ n: number }>();
    expect(breeds?.n).toBeGreaterThan(5);
    const other = await env.DB.prepare('SELECT name FROM breeds WHERE is_other = 1').first<{ name: string }>();
    expect(other?.name).toBe('その他');

    const { results } = await env.DB.prepare(
      'SELECT fixed_key, required FROM survey_questions WHERE is_fixed = 1 ORDER BY sort_order',
    ).all<{ fixed_key: string; required: number }>();
    expect(results).toEqual([
      { fixed_key: 'age_group', required: 1 },
      { fixed_key: 'gender', required: 1 },
      { fixed_key: 'postal_code', required: 0 },
      { fixed_key: 'referral', required: 1 },
      { fixed_key: 'transport', required: 0 },
      { fixed_key: 'preferred_times', required: 0 },
      { fixed_key: 'event_interests', required: 0 },
      { fixed_key: 'uses_other_runs', required: 0 },
      { fixed_key: 'wants_news', required: 0 },
    ]);
  });

  it('設定は初期値で補われ、受付QRの合言葉はランダムに作られる', async () => {
    const s = await loadSettings(env.DB);
    expect(s.points_per_ticket).toBe(10);
    expect(s.grant_point_on_ticket_day).toBe(true);
    expect(s.checkin_passphrase).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('API の土台', () => {
  it('動作確認用の API が応答する', async () => {
    const res = await SELF.fetch('https://example.com/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('ない API には日本語のメッセージ付きで 404 を返す', async () => {
    const res = await call('/api/nothing', { user: 'U001:パパ' });
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/見つかりません/);
  });
});
