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
  it('要件定義書 11章のテーブル(写真をデータベースに保存する media_objects と、送信の印の idempotency_keys を含む)がある', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY name",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual(
      [
        'album_photos',
        'albums',
        'audit_log',
        'booking_capacity_overrides',
        'booking_dogs',
        'booking_dog_guard',
        'booking_guard',
        'booking_notifications',
        'bookings',
        'breeds',
        'calendar',
        'cart_items',
        'daily_stats',
        'daily_weather',
        'day_notes',
        'download_logs',
        'dog_changes',
        'dogs',
        'entitlements',
        'events',
        'family_members',
        'households',
        'idempotency_keys',
        'invites',
        'media_objects',
        'merges',
        'migration_cards',
        'order_items',
        'orders',
        'photo_customers',
        'photo_notifications',
        'photo_uploads',
        'photos',
        'point_ledger',
        'postal_areas',
        'price_lists',
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
        'webhook_events',
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

describe('写真販売のテーブル(マイグレーション 0021。docs/photo-requirements.md 5章)', () => {
  const T2 = '2026-11-03T10:00:00+09:00';
  async function base() {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO photo_customers (id, line_user_id, created_at, updated_at) VALUES (1, 'U1', ?, ?)`).bind(T2, T2),
      env.DB.prepare(`INSERT INTO albums (id, name, kind, event_date, price_list_id, created_at, updated_at) VALUES (1, '2026/11/03', 'date', '2026-11-03', 1, ?, ?)`).bind(T2, T2),
      env.DB.prepare(
        `INSERT INTO photos (id, original_key, sha256, bytes, content_type, original_filename, created_at) VALUES (1, 'originals/a/b.jpg', ?, 100, 'image/jpeg', 'IMG_1.JPG', ?)`,
      ).bind('a'.repeat(64), T2),
      env.DB.prepare(`INSERT INTO orders (id, customer_id, amount, payment_mode, created_at, updated_at) VALUES (1, 1, 500, 'mock', ?, ?)`).bind(T2, T2),
      env.DB.prepare(`INSERT INTO order_items (id, order_id, kind, album_id, photo_id, unit_price, label) VALUES (1, 1, 'photo', 1, 1, 500, 'x')`),
    ]);
  }

  it('価格表の初期案: 通常 500円(日付の既定)・イベント 800円(イベントの既定)。まるごとの価格は未設定', async () => {
    const { results } = await env.DB.prepare('SELECT name, unit_price, album_price, is_default_for FROM price_lists ORDER BY id').all();
    expect(results).toEqual([
      { name: '通常', unit_price: 500, album_price: null, is_default_for: 'date' },
      { name: 'イベント', unit_price: 800, album_price: null, is_default_for: 'event' },
    ]);
  });

  it('同じ人の同じ写真の、有効な権利は1つだけ(返金で無効にしたあとは、もう一度持てる)', async () => {
    await base();
    const grant = () => env.DB.prepare(`INSERT INTO entitlements (customer_id, photo_id, order_item_id, granted_at) VALUES (1, 1, 1, ?)`).bind(T2).run();
    await grant();
    await expect(grant()).rejects.toThrow(/UNIQUE/);
    await env.DB.prepare('UPDATE entitlements SET revoked_at = ?').bind(T2).run();
    await grant();
  });

  it('カートに同じ写真は2回入らない。外したあとは入れ直せる', async () => {
    await base();
    const add = () => env.DB.prepare(`INSERT INTO cart_items (customer_id, kind, album_id, photo_id, added_at) VALUES (1, 'photo', 1, 1, ?)`).bind(T2).run();
    await add();
    await expect(add()).rejects.toThrow(/UNIQUE/);
    await env.DB.prepare('UPDATE cart_items SET removed_at = ?').bind(T2).run();
    await add();
    await env.DB.prepare(`INSERT INTO cart_items (customer_id, kind, album_id, added_at) VALUES (1, 'album', 1, ?)`).bind(T2).run();
    await expect(env.DB.prepare(`INSERT INTO cart_items (customer_id, kind, album_id, added_at) VALUES (1, 'album', 1, ?)`).bind(T2).run()).rejects.toThrow(/UNIQUE/);
  });

  it('明細: 写真1枚なら写真が要り、まるごとなら写真を持たない。価格は50円以上', async () => {
    await base();
    await expect(env.DB.prepare(`INSERT INTO order_items (order_id, kind, album_id, unit_price, label) VALUES (1, 'photo', 1, 500, 'x')`).run()).rejects.toThrow(/CHECK/);
    await expect(env.DB.prepare(`INSERT INTO order_items (order_id, kind, album_id, photo_id, unit_price, label) VALUES (1, 'album', 1, 1, 500, 'x')`).run()).rejects.toThrow(/CHECK/);
    await expect(env.DB.prepare(`INSERT INTO price_lists (name, unit_price, created_at, updated_at) VALUES ('安い', 10, ?, ?)`).bind(T2, T2).run()).rejects.toThrow(/CHECK/);
  });

  it('Stripe の同じ Checkout・同じイベントは1つだけ', async () => {
    await base();
    await env.DB.prepare(`UPDATE orders SET stripe_session_id = 'cs_1' WHERE id = 1`).run();
    await expect(
      env.DB.prepare(`INSERT INTO orders (customer_id, amount, payment_mode, stripe_session_id, created_at, updated_at) VALUES (1, 1, 'mock', 'cs_1', ?, ?)`).bind(T2, T2).run(),
    ).rejects.toThrow(/UNIQUE/);
    const ev = () => env.DB.prepare(`INSERT INTO webhook_events (stripe_event_id, type, status, received_at) VALUES ('evt_1', 't', 'processing', ?)`).bind(T2).run();
    await ev();
    await expect(ev()).rejects.toThrow(/UNIQUE|PRIMARY/);
  });

  it('写真販売の表にも、残高・金額の残りの列を持たない(権利は entitlements から)', async () => {
    const { results } = await env.DB.prepare("SELECT name FROM pragma_table_info('photo_customers')").all<{ name: string }>();
    expect(results.some((r) => /balance|credit/.test(r.name))).toBe(false);
  });
});
