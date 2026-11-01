import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Bindings } from '../src/env';
import { checkPhotoSettingsPatch, photoAlerts } from '../src/services/photos/dashboard';
import { adminCall, call, createStaff, login, registerUser } from './helpers';
import { enablePhotoSales, purchase, seedAlbum } from './p8-delivery-seed';

// PA-1 写真販売のダッシュボードと、PA-7 写真販売の設定

const NOW = '2026-11-20T10:00:00+09:00';

describe('PA-1 ダッシュボード(GET /admin/api/photos/dashboard)', () => {
  let admin: string;
  beforeEach(async () => {
    await createStaff('admin@example.com', 'admin');
    admin = await login('admin@example.com');
  });

  it('今月の売上(返金を引く)・枚数・注文数、販売終了が近いアルバム、最新の注文', async () => {
    const { memberNo } = await registerUser('U001:パパ');
    const a = await seedAlbum({ name: '2026/11/01', saleEndsAt: '2026-11-25T10:00:00+09:00', photos: 4 });
    const b = await seedAlbum({ name: '秋の運動会', saleEndsAt: '2027-05-01T10:00:00+09:00', photos: 2 });
    await seedAlbum({ name: '下書き', status: 'draft', saleEndsAt: '2026-11-21T10:00:00+09:00', photos: 1 });
    const o1 = await purchase('U001:パパ', a.albumId, [a.photos[0]!.id, a.photos[1]!.id], { paidAt: '2026-11-02T12:00:00+09:00', amount: 1000 });
    const o2 = await purchase('U002:ママ', b.albumId, [b.photos[0]!.id], { paidAt: '2026-11-10T12:00:00+09:00', amount: 500 });
    // 先月の注文・お支払い待ちは数えない
    const o3 = await purchase('U003:先月', a.albumId, [a.photos[2]!.id], { paidAt: '2026-10-31T23:59:00+09:00', amount: 500 });
    await purchase('U004:待ち', a.albumId, [a.photos[3]!.id], { status: 'pending', paidAt: '2026-11-15T12:00:00+09:00' });
    // パパの1枚を返金(一部返金)
    await env.DB.prepare("UPDATE orders SET status = 'partially_refunded', refunded_amount = 500 WHERE id = ?").bind(o1.orderId).run();
    await env.DB.prepare("UPDATE entitlements SET revoked_at = ? WHERE id = ?").bind(NOW, o1.entitlementIds[1]).run();

    const r = await adminCall('/admin/api/photos/dashboard', { cookie: admin, now: NOW });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ month: '2026-11', salesYen: 1000, soldPhotos: 2, orders: 2 });
    // 販売終了が近い(7日以内)公開中のアルバムだけ。売れていない写真の数(返金した写真・お支払い待ちの写真は売れていない。先月売れた写真は売れている)
    expect(r.body.endingSoon).toEqual([{ albumId: a.albumId, name: '2026/11/01', saleEndsAt: '2026-11-25T10:00:00+09:00', unsoldPhotos: 2 }]);
    expect(r.body.recentOrders.map((o: any) => o.id)).toEqual([o2.orderId, o1.orderId, o3.orderId]);
    expect(r.body.recentOrders[1]).toMatchObject({
      id: o1.orderId,
      status: 'partially_refunded',
      amount: 1000,
      refundedAmount: 500,
      customerName: 'パパ',
      memberNo,
      itemCount: 2,
      paymentMode: 'mock',
    });
    expect(r.body.availability).toMatchObject({ storage: 'fallback', payments: 'mock', enabledSetting: false });
  });

  it('製作者は見られる。受付スタッフは 403', async () => {
    await createStaff('dev@example.com', 'developer');
    await createStaff('staff@example.com', 'staff');
    expect((await adminCall('/admin/api/photos/dashboard', { cookie: await login('dev@example.com') })).status).toBe(200);
    expect((await adminCall('/admin/api/photos/dashboard', { cookie: await login('staff@example.com') })).status).toBe(403);
  });

  it('知らせること: 確認用の値が合わなかった写真、ダウンロードの上限に達した写真', async () => {
    await enablePhotoSales();
    const a = await seedAlbum({ photos: 2 });
    await purchase('U001:パパ', a.albumId, [a.photos[0]!.id]);
    await env.DB.prepare('UPDATE photos SET hash_mismatch_at = ? WHERE id = ?').bind(NOW, a.photos[1]!.id).run();
    for (let i = 0; i < 10; i++) {
      await call(`/api/photos/purchases/${a.photos[0]!.id}/download`, { user: 'U001:パパ', method: 'POST', now: NOW });
    }
    expect(await photoAlerts(env.DB, new Date(NOW), { count: 10, hours: 24 })).toEqual({ hashMismatchPhotos: 1, downloadLimitHits: 1 });
    expect(await photoAlerts(env.DB, new Date('2026-11-21T10:00:01+09:00'), { count: 10, hours: 24 })).toEqual({ hashMismatchPhotos: 1, downloadLimitHits: 0 });
  });
});

describe('PA-7 写真販売の設定(GET / PATCH /admin/api/settings の photo_ の項目)', () => {
  let admin: string;
  beforeEach(async () => {
    await createStaff('admin@example.com', 'admin');
    admin = await login('admin@example.com');
  });

  it('管理者は変えられる。操作ログに残る', async () => {
    const r = await adminCall('/admin/api/settings', {
      cookie: admin,
      method: 'PATCH',
      body: {
        photo_watermark_text: 'GREEN DOME SAMPLE',
        photo_sale_months: 12,
        photo_deletion_notice_days: 14,
        photo_download_limit: { count: 5, hours: 12 },
        photo_tokushoho_text: '販売者: グリーンドーム',
        photo_terms_text: '個人の利用に限ります。',
        photo_sales_enabled: true,
      },
    });
    expect(r.status).toBe(200);
    expect(r.body.settings).toMatchObject({ photo_watermark_text: 'GREEN DOME SAMPLE', photo_sale_months: 12, photo_download_limit: { count: 5, hours: 12 }, photo_sales_enabled: true });
    const log = await env.DB.prepare("SELECT target_id FROM audit_log WHERE action = 'settings.update'").first<any>();
    expect(log.target_id).toContain('photo_sale_months');
    // お客さんの設定にも反映される
    expect((await call('/api/photos/config', { user: 'U001:パパ' })).body).toMatchObject({ available: true, downloadLimit: { count: 5, hours: 12 } });
  });

  it('おかしな値は 400(日本語の理由)', async () => {
    for (const body of [
      { photo_sale_months: 0 },
      { photo_sale_months: 37 },
      { photo_watermark_text: 'あ'.repeat(41) },
      { photo_download_limit: { count: 0, hours: 24 } },
      { photo_download_limit: { count: 10, hours: 200 } },
      { photo_deletion_notice_days: 0 },
      { photo_refund_days: -1 },
      { photo_sales_enabled: 'yes' },
    ]) {
      const r = await adminCall('/admin/api/settings', { cookie: admin, method: 'PATCH', body });
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.error.message).toMatch(/[ぁ-んァ-ヶ一-龠]/);
    }
  });

  it('製作者は変えられない(403)。受付スタッフは見ることもできない', async () => {
    await createStaff('dev@example.com', 'developer');
    await createStaff('staff@example.com', 'staff');
    const dev = await login('dev@example.com');
    expect((await adminCall('/admin/api/settings', { cookie: dev })).status).toBe(200);
    expect((await adminCall('/admin/api/settings', { cookie: dev, method: 'PATCH', body: { photo_sales_enabled: true } })).status).toBe(403);
    expect((await adminCall('/admin/api/settings', { cookie: dev, method: 'PATCH', body: { photo_watermark_text: 'x' } })).status).toBe(403);
    const staff = await login('staff@example.com');
    expect((await adminCall('/admin/api/settings', { cookie: staff, method: 'PATCH', body: { photo_sales_enabled: true } })).status).toBe(403);
  });

  it('「販売する」は、写真の置き場所(R2)とお支払いがそろっていなければ選べない', () => {
    const prodNoR2 = { ...env, ENVIRONMENT: 'production', STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh' } as unknown as Bindings;
    expect(checkPhotoSettingsPatch(prodNoR2, { photo_sales_enabled: true })).toContain('写真の置き場所(R2)がまだ設定されていません');
    expect(checkPhotoSettingsPatch(prodNoR2, { photo_sales_enabled: false })).toBeNull();
    expect(checkPhotoSettingsPatch(prodNoR2, { photo_watermark_text: 'x' })).toBeNull();
    const prodNoStripe = { ...env, ENVIRONMENT: 'production', PHOTOS: env.MEDIA, R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', PHOTOS_BUCKET_NAME: 'b' } as unknown as Bindings;
    expect(checkPhotoSettingsPatch(prodNoStripe, { photo_sales_enabled: true })).toContain('Stripe');
    // local・test は代わりの置き場所とまねの Stripe で動く
    expect(checkPhotoSettingsPatch(env as unknown as Bindings, { photo_sales_enabled: true })).toBeNull();
  });
});
