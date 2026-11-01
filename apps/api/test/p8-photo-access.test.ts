import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { photoAvailability } from '../src/lib/photos/availability';
import { ensurePhotoCustomer } from '../src/lib/photos/customers';
import { sentThisMonth } from '../src/services/line-push';
import { adminCall, call, createStaff, login, registerUser } from './helpers';

// 写真販売の権限と「準備中」(docs/photo-requirements.md 4章・6章)

const NOW = '2026-11-03T10:00:00+09:00';

/** 管理画面の写真販売の、変更の API(段階0で決めたもの。段階1で中身を作る) */
const ADMIN_WRITES: [string, string][] = [
  ['POST', '/admin/api/photos/albums'],
  ['POST', '/admin/api/photos/albums/from-folders'],
  ['POST', '/admin/api/photos/albums/publish'],
  ['PATCH', '/admin/api/photos/albums/1'],
  ['POST', '/admin/api/photos/albums/1/publish'],
  ['POST', '/admin/api/photos/albums/1/remove'],
  ['POST', '/admin/api/photos/albums/1/restore'],
  ['POST', '/admin/api/photos/albums/1/photos/bulk'],
  ['POST', '/admin/api/photos/albums/1/uploads'],
  ['POST', '/admin/api/photos/uploads/u1/parts'],
  ['PUT', '/admin/api/photos/uploads/u1/parts/1'],
  ['PUT', '/admin/api/photos/uploads/u1/derivatives/preview'],
  ['POST', '/admin/api/photos/uploads/u1/derivatives'],
  ['POST', '/admin/api/photos/uploads/u1/complete'],
  ['DELETE', '/admin/api/photos/uploads/u1'],
  ['POST', '/admin/api/photos/price-lists'],
  ['PUT', '/admin/api/photos/price-lists/defaults'],
  ['PATCH', '/admin/api/photos/price-lists/1'],
  ['POST', '/admin/api/photos/orders/1/refund'],
];

const ADMIN_READS = [
  '/admin/api/photos/availability',
  '/admin/api/photos/albums',
  '/admin/api/photos/albums/1',
  '/admin/api/photos/photos/1/thumb',
  '/admin/api/photos/uploads/u1',
  '/admin/api/photos/price-lists',
  '/admin/api/photos/orders',
  '/admin/api/photos/orders/1',
  '/admin/api/photos/dashboard',
];

const CUSTOMER_ROUTES: [string, string][] = [
  ['GET', '/api/photos/albums'],
  ['GET', '/api/photos/albums/1'],
  ['GET', '/api/photos/media/1/1/thumb'],
  ['GET', '/api/photos/cart'],
  ['POST', '/api/photos/cart/items'],
  ['DELETE', '/api/photos/cart/items/1'],
  ['POST', '/api/photos/checkout'],
  ['GET', '/api/photos/orders'],
  ['GET', '/api/photos/purchases'],
  ['POST', '/api/photos/purchases/1/download'],
  ['POST', '/api/photos/purchases/zip'],
];

async function enablePhotoSales() {
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('photo_sales_enabled', 'true', ?)").bind(NOW).run();
}

describe('管理画面の写真販売の権限', () => {
  let admin: string;
  let staff: string;
  let developer: string;
  beforeEach(async () => {
    await createStaff('admin@example.com', 'admin');
    await createStaff('staff@example.com', 'staff');
    await createStaff('dev@example.com', 'developer');
    admin = await login('admin@example.com');
    staff = await login('staff@example.com');
    developer = await login('dev@example.com');
  });

  it('製作者は、変更の API がすべて 403', async () => {
    for (const [method, path] of ADMIN_WRITES) {
      const r = await adminCall(path, { cookie: developer, method, body: {} });
      expect(r.status, `${method} ${path}`).toBe(403);
    }
  });

  it('受付スタッフは、見ることも変えることもできない(403)', async () => {
    for (const path of ADMIN_READS) expect((await adminCall(path, { cookie: staff })).status, path).toBe(403);
    for (const [method, path] of ADMIN_WRITES) expect((await adminCall(path, { cookie: staff, method, body: {} })).status, `${method} ${path}`).toBe(403);
  });

  it('製作者は見られる。管理者は 403 にならない', async () => {
    for (const path of ADMIN_READS) {
      expect((await adminCall(path, { cookie: developer })).status, path).not.toBe(403);
      expect((await adminCall(path, { cookie: admin })).status, path).not.toBe(403);
    }
    for (const [method, path] of ADMIN_WRITES) {
      expect((await adminCall(path, { cookie: admin, method, body: {} })).status, `${method} ${path}`).not.toBe(403);
    }
  });

  it('ログインしていなければ 401', async () => {
    expect((await adminCall('/admin/api/photos/albums')).status).toBe(401);
  });

  it('置き場所・決済・設定の状態(local・test は代わりの置き場所とまねの Stripe)', async () => {
    const r = await adminCall('/admin/api/photos/availability', { cookie: admin });
    expect(r.body).toEqual({
      available: false,
      enabledSetting: false,
      storage: 'fallback',
      payments: 'mock',
      message: '写真の販売は止めています。始めるときは、写真販売の設定で「販売する」を選んでください。',
    });
  });

  it('システムの状態に、写真の置き場所の状態が出る', async () => {
    const r = await adminCall('/admin/api/system-status', { cookie: admin });
    expect(r.body.photoSales).toMatchObject({ storage: 'fallback', payments: 'mock' });
  });
});

describe('本番で R2・Stripe の設定がないときは「準備中」', () => {
  const settings = { photo_sales_enabled: true };
  it('R2 がなければ「写真の置き場所(R2)がまだ設定されていません」', () => {
    const a = photoAvailability({ ...env, ENVIRONMENT: 'production', STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh' }, settings);
    expect(a).toMatchObject({ available: false, storage: 'missing', payments: 'live' });
    expect(a.message).toContain('写真の置き場所(R2)がまだ設定されていません');
  });
  it('Stripe がなければ準備中', () => {
    const a = photoAvailability(
      { ...env, ENVIRONMENT: 'production', PHOTOS: env.MEDIA, R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', PHOTOS_BUCKET_NAME: 'b' },
      settings,
    );
    expect(a).toMatchObject({ available: false, storage: 'r2', payments: 'missing' });
  });
  it('本番では STRIPE_MOCK を付けても、まねにならない', () => {
    const a = photoAvailability({ ...env, ENVIRONMENT: 'production', STRIPE_MOCK: '1' }, settings);
    expect(a.payments).toBe('missing');
  });
  it('すべてそろい、設定が on なら使える', () => {
    const a = photoAvailability(
      { ...env, ENVIRONMENT: 'production', PHOTOS: env.MEDIA, R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', PHOTOS_BUCKET_NAME: 'b', STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh' },
      settings,
    );
    expect(a).toEqual({ available: true, enabledSetting: true, storage: 'r2', payments: 'live', message: null });
  });
});

describe('お客さん向けの写真販売', () => {
  it('準備中(初期値)は 503。/config は答える。会員でなくても開ける', async () => {
    const config = await call('/api/photos/config', { user: 'U801:ゲスト', now: NOW });
    expect(config.status).toBe(200);
    expect(config.body).toMatchObject({ available: false, facilityName: 'グリーンドーム', refundDays: 7, downloadLimit: { count: 10, hours: 24 } });
    for (const [method, path] of CUSTOMER_ROUTES) {
      const r = await call(path, { user: 'U801:ゲスト', method, body: method === 'GET' ? undefined : {}, now: NOW });
      expect(r.status, `${method} ${path}`).toBe(503);
      expect(r.body.error.code).toBe('photo_sales_unavailable');
    }
  });

  it('LINE のログインがなければ 401', async () => {
    expect((await call('/api/photos/config')).status).toBe(401);
    expect((await call('/api/photos/albums')).status).toBe(401);
  });

  it('販売を始めると、準備中ではなくなる', async () => {
    await enablePhotoSales();
    expect((await call('/api/photos/config', { user: 'U801:ゲスト' })).body.available).toBe(true);
    for (const [method, path] of CUSTOMER_ROUTES) {
      const r = await call(path, { user: 'U801:ゲスト', method, body: method === 'GET' ? undefined : {}, now: NOW });
      expect(r.status, `${method} ${path}`).not.toBe(503);
    }
  });

  it('法定表示は、ログインなしで読める', async () => {
    const r = await call('/api/photos/legal');
    expect(r.status).toBe(200);
    expect(r.body.terms).toContain('7日以内');
    expect(r.body.facilityName).toBe('グリーンドーム');
  });

  it('まねの支払いの口は、ほかの人の注文には使えない(404)', async () => {
    await enablePhotoSales();
    const other = await ensurePhotoCustomer(env.DB, { userId: 'U802', displayName: 'ほかの人' }, new Date(NOW));
    await env.DB.prepare(
      `INSERT INTO orders (customer_id, status, amount, payment_mode, stripe_session_id, created_at, updated_at)
       VALUES (?, 'pending', 500, 'mock', 'cs_mock_1_0123456789abcdef', ?, ?)`,
    )
      .bind(other.id, NOW, NOW)
      .run();
    expect((await call('/api/photos/mock-stripe/sessions/cs_mock_1_0123456789abcdef', { user: 'U801:ゲスト' })).status).toBe(404);
    const mine = await call('/api/photos/mock-stripe/sessions/cs_mock_1_0123456789abcdef', { user: 'U802:ほかの人' });
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ amount: 500, status: 'pending', successUrl: 'https://dogrun.test/liff/photos/orders/1', cancelUrl: 'https://dogrun.test/liff/photos/cart' });
  });
});

describe('購入者(photo_customers)', () => {
  it('LINE アカウントごとに1行。会員なら、おうちと家族を記録だけする', async () => {
    const guest = await ensurePhotoCustomer(env.DB, { userId: 'U810', displayName: 'ゲスト' }, new Date(NOW));
    expect(guest).toMatchObject({ householdId: null, familyMemberId: null, displayName: 'ゲスト' });
    await registerUser('U810:ゲスト');
    const again = await ensurePhotoCustomer(env.DB, { userId: 'U810', displayName: 'ゲスト2' }, new Date(NOW));
    expect(again.id).toBe(guest.id);
    expect(again.householdId).not.toBeNull();
    expect(again.familyMemberId).not.toBeNull();
    expect(again.displayName).toBe('ゲスト2');
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM photo_customers').first<{ n: number }>();
    expect(n!.n).toBe(1);
  });
});

describe('LINE のお知らせのひと月の上限', () => {
  it('予約のお知らせと、写真の購入完了のお知らせを合わせて数える', async () => {
    const c = await ensurePhotoCustomer(env.DB, { userId: 'U820', displayName: 'A' }, new Date(NOW));
    await env.DB.prepare(
      `INSERT INTO orders (id, customer_id, status, amount, payment_mode, created_at, updated_at) VALUES (1, ?, 'paid', 500, 'mock', ?, ?)`,
    )
      .bind(c.id, NOW, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO photo_notifications (order_id, customer_id, kind, status, message, month, created_at) VALUES (1, ?, 'purchase_complete', 'sent', 'x', '2026-11', ?)`,
    )
      .bind(c.id, NOW)
      .run();
    expect(await sentThisMonth(env.DB, new Date(NOW))).toBe(1);
  });
});
