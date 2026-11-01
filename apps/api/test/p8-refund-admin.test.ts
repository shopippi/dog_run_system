import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveStripeClient, MOCK_WEBHOOK_SECRET, mockStripeEvent, signStripePayload } from '../src/lib/photos/stripe';
import { refundOrder } from '../src/services/photos/refund';
import { adminCall, call, createStaff, login } from './helpers';
import { BUYER, NOW, OTHER, buy, enablePhotoSales, entitlementsOf, seedAlbum } from './p8-checkout-fixtures';

// PA-6 注文と返金(docs/photo-requirements.md 3.5)。7日・ダウンロード済み・条件の外は理由・権利の無効化・権限

let admin: string;
let developer: string;
let staff: string;

beforeEach(async () => {
  await enablePhotoSales();
  await createStaff('admin@example.com', 'admin');
  await createStaff('dev@example.com', 'developer');
  await createStaff('staff@example.com', 'staff');
  admin = await login('admin@example.com');
  developer = await login('dev@example.com');
  staff = await login('staff@example.com');
});

/** 写真2枚とまるごと1つの注文(お支払い済み) */
async function paidOrder(user = BUYER) {
  const a = await seedAlbum({ name: '2026/11/01', unitPrice: 500, photos: 2 });
  const b = await seedAlbum({ name: '運動会', unitPrice: 800, albumPrice: 2000, photos: 3 });
  const orderId = await buy(
    [
      { kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0]! },
      { kind: 'photo', albumId: a.albumId, photoId: a.photoIds[1]! },
      { kind: 'album', albumId: b.albumId },
    ],
    user,
  );
  const { results: items } = await env.DB.prepare('SELECT id, kind, photo_id FROM order_items WHERE order_id = ? ORDER BY id').bind(orderId).all<{ id: number; kind: string; photo_id: number | null }>();
  return { orderId, items, a, b };
}

async function logDownload(photoId: number, at = '2026-11-03T12:00:00+09:00', user = BUYER) {
  await env.DB.prepare(
    `INSERT INTO download_logs (customer_id, photo_id, entitlement_id, kind, user_agent, created_at)
     SELECT c.id, ?, (SELECT id FROM entitlements WHERE customer_id = c.id AND photo_id = ? AND revoked_at IS NULL), 'original', 'Mozilla/5.0 (iPhone)', ?
       FROM photo_customers c WHERE c.line_user_id = ?`,
  )
    .bind(photoId, photoId, at, user.split(':')[0])
    .run();
}

const refund = (orderId: number, body: unknown, opts: { cookie?: string; now?: string } = {}) =>
  adminCall(`/admin/api/photos/orders/${orderId}/refund`, { cookie: opts.cookie ?? admin, body, now: opts.now ?? '2026-11-05T10:00:00+09:00' });

describe('注文の一覧と内容', () => {
  it('一覧(新しい順)・状態で絞る・名前や番号で探す', async () => {
    const first = await paidOrder();
    const second = await paidOrder(OTHER);
    const all = await adminCall('/admin/api/photos/orders', { cookie: admin });
    expect(all.status).toBe(200);
    expect(all.body.orders.map((o: any) => o.id)).toEqual([second.orderId, first.orderId]);
    expect(all.body.orders[0]).toMatchObject({ status: 'paid', amount: 3000, refundedAmount: 0, customerName: 'ほか', itemCount: 3, paymentMode: 'mock', memberNo: null });
    expect(all.body.nextBefore).toBeNull();
    const byName = await adminCall(`/admin/api/photos/orders?q=${encodeURIComponent('かい')}`, { cookie: admin });
    expect(byName.body.orders.map((o: any) => o.id)).toEqual([first.orderId]);
    const byId = await adminCall(`/admin/api/photos/orders?q=${first.orderId}`, { cookie: admin });
    expect(byId.body.orders.map((o: any) => o.id)).toContain(first.orderId);
    const pending = await adminCall('/admin/api/photos/orders?status=pending', { cookie: admin });
    expect(pending.body.orders).toEqual([]);
  });

  it('内容: 明細ごとの返金の可否・ダウンロードの記録(見るだけ)', async () => {
    const { orderId, items, a, b } = await paidOrder();
    await logDownload(a.photoIds[1]!);
    await logDownload(b.photoIds[2]!, '2026-11-03T12:05:00+09:00');
    const r = await adminCall(`/admin/api/photos/orders/${orderId}`, { cookie: admin, now: '2026-11-04T10:00:00+09:00' });
    expect(r.status).toBe(200);
    expect(r.body.order).toMatchObject({ id: orderId, status: 'paid', customerName: 'かい' });
    expect(r.body.items.map((i: any) => [i.id, i.refund.eligible, i.downloads])).toEqual([
      [items[0]!.id, true, 0],
      [items[1]!.id, false, 1],
      [items[2]!.id, false, 1],
    ]);
    expect(r.body.items[0].refund.deadline).toBe('2026-11-10T10:00:00+09:00');
    expect(r.body.items[1].refund.reason).toContain('もうダウンロードしています');
    expect(r.body.items[2]).toMatchObject({ kind: 'album', albumName: '運動会', label: '運動会 まるごと(3枚)', unitPrice: 2000 });
    expect(r.body.items[0].thumbUrl).toBe(`/admin/api/photos/photos/${a.photoIds[0]}/thumb`);
    expect(r.body.downloads).toEqual([
      { photoId: b.photoIds[2], kind: 'original', createdAt: '2026-11-03T12:05:00+09:00', userAgent: 'Mozilla/5.0 (iPhone)' },
      { photoId: a.photoIds[1], kind: 'original', createdAt: '2026-11-03T12:00:00+09:00', userAgent: 'Mozilla/5.0 (iPhone)' },
    ]);
  });

  it('ない注文は 404', async () => {
    expect((await adminCall('/admin/api/photos/orders/999', { cookie: admin })).status).toBe(404);
  });
});

describe('返金', () => {
  it('7日以内でダウンロードしていない明細は返金できる。権利を無効にし、一部返金 → 全部で返金済み', async () => {
    const { orderId, items, a, b } = await paidOrder();
    const r = await refund(orderId, { itemIds: [items[0]!.id], reason: '間違えて買った' });
    expect(r.status).toBe(200);
    expect(r.body.refundedItemIds).toEqual([items[0]!.id]);
    expect(r.body.order).toMatchObject({ status: 'partially_refunded', refundedAmount: 500 });
    expect(r.body.auditId).toEqual(expect.any(Number));
    const item = await env.DB.prepare('SELECT refunded_at, refund_amount, stripe_refund_id, refund_reason, refund_override, refunded_by_staff_id FROM order_items WHERE id = ?').bind(items[0]!.id).first<any>();
    expect(item).toMatchObject({ refunded_at: '2026-11-05T10:00:00+09:00', refund_amount: 500, refund_reason: '間違えて買った', refund_override: 0 });
    expect(item.stripe_refund_id).toMatch(/^re_mock_/);
    const ents = await entitlementsOf();
    expect(ents.find((e) => e.photo_id === a.photoIds[0])!.revoked_at).toBe('2026-11-05T10:00:00+09:00');
    expect(ents.filter((e) => e.revoked_at === null)).toHaveLength(4);
    const log = await env.DB.prepare("SELECT actor_type, reason, after_value FROM audit_log WHERE action = 'photo_order.refund'").first<any>();
    expect(log.actor_type).toBe('staff');
    expect(log.reason).toBe('間違えて買った');

    const rest = await refund(orderId, { itemIds: [items[1]!.id, items[2]!.id], reason: 'まとめて返金' });
    expect(rest.body.order).toMatchObject({ status: 'refunded', refundedAmount: 3000 });
    expect((await entitlementsOf()).every((e) => e.revoked_at)).toBe(true);
    expect(b.photoIds).toHaveLength(3);
  });

  it('購入から7日を過ぎたら断る。理由を書いて「条件の外で返金する」なら返金でき、操作ログに残る', async () => {
    const { orderId, items } = await paidOrder();
    const late = '2026-11-10T10:00:01+09:00';
    const r = await refund(orderId, { itemIds: [items[0]!.id], reason: '連絡が遅れた' }, { now: late });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('refund_not_eligible');
    expect(r.body.error.message).toContain('条件の外で返金する');
    expect(r.body.error.details.items[0].reason).toContain('7日を過ぎています');
    const ok = await refund(orderId, { itemIds: [items[0]!.id], reason: '連絡が遅れた', override: true }, { now: late });
    expect(ok.status).toBe(200);
    const item = await env.DB.prepare('SELECT refund_override FROM order_items WHERE id = ?').bind(items[0]!.id).first<{ refund_override: number }>();
    expect(item!.refund_override).toBe(1);
    const log = await env.DB.prepare("SELECT reason, after_value FROM audit_log WHERE action = 'photo_order.refund'").first<any>();
    expect(log.reason).toBe('条件の外で返金: 連絡が遅れた');
    expect(JSON.parse(log.after_value)).toMatchObject({ override: true, overriddenItemIds: [items[0]!.id] });
  });

  it('ダウンロードした写真(まるごとは1枚でも)は断る。override なら返金できる', async () => {
    const { orderId, items, b } = await paidOrder();
    await logDownload(b.photoIds[0]!);
    const r = await refund(orderId, { itemIds: [items[2]!.id], reason: '写りが悪い' });
    expect(r.status).toBe(409);
    expect(r.body.error.details.items[0].reason).toContain('ダウンロード');
    const ok = await refund(orderId, { itemIds: [items[2]!.id], reason: '写りが悪い', override: true });
    expect(ok.status).toBe(200);
    expect((await entitlementsOf()).filter((e) => b.photoIds.includes(e.photo_id)).every((e) => e.revoked_at)).toBe(true);
  });

  it('返金の期間は設定で変わる', async () => {
    await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('photo_refund_days', '1', ?)").bind(NOW).run();
    const { orderId, items } = await paidOrder();
    const r = await refund(orderId, { itemIds: [items[0]!.id], reason: 'x' }, { now: '2026-11-04T10:00:01+09:00' });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toContain('購入から1日以内');
  });

  it('もう返金した明細・ほかの注文の明細・お支払い前の注文は返金できない。理由は必ず要る', async () => {
    const { orderId, items } = await paidOrder();
    await refund(orderId, { itemIds: [items[0]!.id], reason: 'x' });
    const twice = await refund(orderId, { itemIds: [items[0]!.id], reason: 'x', override: true });
    expect(twice.status).toBe(409);
    const other = await paidOrder(OTHER);
    expect((await refund(orderId, { itemIds: [other.items[0]!.id], reason: 'x' })).status).toBe(400);
    expect((await refund(orderId, { itemIds: [items[1]!.id], reason: '' })).status).toBe(400);
    expect((await refund(orderId, { itemIds: [items[1]!.id] })).status).toBe(400);
    await env.DB.prepare(
      `INSERT INTO orders (id, customer_id, status, amount, payment_mode, created_at, updated_at) SELECT 900, customer_id, 'pending', 500, 'mock', ?, ? FROM orders WHERE id = ?`,
    )
      .bind(NOW, NOW, orderId)
      .run();
    expect((await refund(900, { itemIds: [1], reason: 'x' })).status).toBe(409);
  });

  it('製作者は返金できない(403)。受付は見ることもできない(403)', async () => {
    const { orderId, items } = await paidOrder();
    expect((await refund(orderId, { itemIds: [items[0]!.id], reason: 'x' }, { cookie: developer })).status).toBe(403);
    expect((await adminCall(`/admin/api/photos/orders/${orderId}`, { cookie: developer })).status).toBe(200);
    expect((await adminCall('/admin/api/photos/orders', { cookie: staff })).status).toBe(403);
    expect((await adminCall(`/admin/api/photos/orders/${orderId}`, { cookie: staff })).status).toBe(403);
    expect((await refund(orderId, { itemIds: [items[0]!.id], reason: 'x' }, { cookie: staff })).status).toBe(403);
    const item = await env.DB.prepare('SELECT refunded_at FROM order_items WHERE id = ?').bind(items[0]!.id).first<{ refunded_at: string | null }>();
    expect(item!.refunded_at).toBeNull();
  });

  it('本物の Stripe には、明細ごとに金額と送信の印を付けて返金を頼む', async () => {
    const { orderId, items } = await paidOrder();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: 're_test_1', status: 'succeeded' }), { status: 200 }));
    const stripe = new LiveStripeClient('sk_test_x', fetcher as unknown as typeof fetch);
    const res = await refundOrder({ db: env.DB, stripe, orderId, input: { itemIds: [items[0]!.id, items[2]!.id], reason: 'x', override: false }, staffId: 1, now: new Date('2026-11-04T10:00:00+09:00'), refundDays: 7 });
    expect(res.refundedItemIds).toEqual([items[0]!.id, items[2]!.id]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    const bodies = calls.map(([, init]) => new URLSearchParams(String(init.body)));
    expect(bodies.map((b) => b.get('amount'))).toEqual(['500', '2000']);
    expect(bodies[0]!.get('payment_intent')).toBe(`pi_mock_${orderId}`);
    expect(calls.map(([, init]) => (init.headers as Record<string, string>)['idempotency-key'])).toEqual([`photo-refund-item-${items[0]!.id}`, `photo-refund-item-${items[2]!.id}`]);
  });

  it('Stripe の返金に失敗したら、その明細は返金済みにしない(502)', async () => {
    const { orderId, items } = await paidOrder();
    const stripe = new LiveStripeClient('sk_test_x', (async () => new Response('{"error":{"message":"no"}}', { status: 402 })) as unknown as typeof fetch);
    await expect(
      refundOrder({ db: env.DB, stripe, orderId, input: { itemIds: [items[0]!.id], reason: 'x', override: false }, staffId: 1, now: new Date('2026-11-04T10:00:00+09:00'), refundDays: 7 }),
    ).rejects.toMatchObject({ status: 502 });
    expect((await entitlementsOf()).every((e) => e.revoked_at === null)).toBe(true);
  });
});

describe('Stripe からの返金のお知らせ(charge.refunded)', () => {
  async function sendRefunded(orderId: number, amountRefunded: number, full: boolean) {
    const { SELF } = await import('cloudflare:test');
    const event = mockStripeEvent('charge.refunded', { id: 'ch_1', object: 'charge', payment_intent: `pi_mock_${orderId}`, amount_refunded: amountRefunded, refunded: full, refunds: { data: [{ id: 're_dash_1' }] } }, new Date(NOW));
    const payload = JSON.stringify(event);
    const res = await SELF.fetch('https://dogrun.test/api/photos/stripe/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': await signStripePayload(MOCK_WEBHOOK_SECRET, payload, new Date(NOW)), 'x-debug-now': NOW },
      body: payload,
    });
    return (await res.json()) as any;
  }

  it('全額の返金なら、残りの明細を返金済みにして権利を無効にする', async () => {
    const { orderId } = await paidOrder();
    const r = await sendRefunded(orderId, 3000, true);
    expect(r.status).toBe('processed');
    expect((await entitlementsOf()).every((e) => e.revoked_at)).toBe(true);
    const o = await env.DB.prepare('SELECT status, refunded_amount FROM orders WHERE id = ?').bind(orderId).first();
    expect(o).toEqual({ status: 'refunded', refunded_amount: 3000 });
    // 購入した写真の注文の画面にも「返金済み」
    expect((await call(`/api/photos/orders/${orderId}`, { user: BUYER })).body.order.status).toBe('refunded');
  });

  it('管理画面で返金した分は、二重にしない', async () => {
    const { orderId, items } = await paidOrder();
    await refund(orderId, { itemIds: [items[0]!.id], reason: 'x' });
    const r = await sendRefunded(orderId, 500, false);
    expect(r.status).toBe('processed');
    const o = await env.DB.prepare('SELECT status, refunded_amount FROM orders WHERE id = ?').bind(orderId).first();
    expect(o).toEqual({ status: 'partially_refunded', refunded_amount: 500 });
    expect((await entitlementsOf()).filter((e) => e.revoked_at)).toHaveLength(1);
  });

  it('どの明細か分からない一部の返金は、権利をそのままにして操作ログで知らせる', async () => {
    const { orderId } = await paidOrder();
    await sendRefunded(orderId, 300, false);
    expect((await entitlementsOf()).every((e) => e.revoked_at === null)).toBe(true);
    const log = await env.DB.prepare("SELECT reason FROM audit_log WHERE action = 'photo_order.refund_unmatched'").first<{ reason: string }>();
    expect(log!.reason).toContain('どの写真の分か');
  });
});
