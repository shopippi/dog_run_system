import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensurePhotoCustomer } from '../src/lib/photos/customers';
import { LiveStripeClient, STRIPE_API_VERSION } from '../src/lib/photos/stripe';
import { createCheckout } from '../src/services/photos/checkout';
import { call } from './helpers';
import { BUYER, NOW, OTHER, addItems, buy, checkout, enablePhotoSales, getCart, seedAlbum } from './p8-checkout-fixtures';

// 購入手続き(docs/photo-requirements.md 3.9・8.1)。金額はサーバー・明細が複数の Checkout・送信の印・自分の注文だけ

beforeEach(enablePhotoSales);

describe('購入手続き', () => {
  it('ok の行だけで注文(お支払い待ち)と明細を作り、まねの支払いの画面の URL を返す。除いた行を知らせる', async () => {
    const a = await seedAlbum({ name: '2026/11/01', unitPrice: 500, albumPrice: 1200, photos: 2 });
    const b = await seedAlbum({ name: '運動会', unitPrice: 800, photos: 2 });
    const add = await addItems([
      { kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0]! },
      { kind: 'album', albumId: a.albumId },
      { kind: 'photo', albumId: b.albumId, photoId: b.photoIds[0]! },
      { kind: 'photo', albumId: b.albumId, photoId: b.photoIds[1]! },
    ]);
    await env.DB.prepare("UPDATE album_photos SET status = 'hidden' WHERE photo_id = ?").bind(b.photoIds[1]).run();
    const r = await checkout();
    expect(r.status).toBe(200);
    expect(r.body.amount).toBe(1200 + 800);
    expect(r.body.checkoutUrl).toMatch(/^https:\/\/dogrun\.test\/liff\/photos\/mock-checkout\/cs_mock_\d+_[0-9a-f]{16}$/);
    const [redundant, , , hidden] = add.body.items;
    expect(r.body.excludedItemIds.sort()).toEqual([redundant.id, hidden.id].sort());

    const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(r.body.orderId).first<any>();
    expect(order).toMatchObject({ status: 'pending', amount: 2000, payment_mode: 'mock', currency: 'jpy', paid_at: null });
    expect(order.stripe_session_id).toBe(r.body.checkoutUrl.split('/').pop());
    expect(order.expires_at).toBe('2026-11-03T11:00:00+09:00');
    const { results: items } = await env.DB.prepare('SELECT kind, album_id, photo_id, unit_price, label FROM order_items WHERE order_id = ? ORDER BY id')
      .bind(r.body.orderId)
      .all<any>();
    expect(items).toEqual([
      { kind: 'album', album_id: a.albumId, photo_id: null, unit_price: 1200, label: '2026/11/01 まるごと(2枚)' },
      { kind: 'photo', album_id: b.albumId, photo_id: b.photoIds[0], unit_price: 800, label: expect.stringMatching(/^運動会 IMG_\d{4}$/) },
    ]);
    // カートの行は、お支払いの確定まで残す
    expect((await getCart()).body.items).toHaveLength(4);
    // まねの支払いの画面の中身(明細が複数)
    const mock = await call(`/api/photos/mock-stripe/sessions/${order.stripe_session_id}`, { user: BUYER });
    expect(mock.body.lines).toHaveLength(2);
    expect(mock.body.amount).toBe(2000);
  });

  it('購入手続きの直前にも確かめる(カートを見たあとに販売が終わった写真は除く)', async () => {
    const a = await seedAlbum({ photos: 1 });
    const b = await seedAlbum({ unitPrice: 700, photos: 1 });
    await addItems([
      { kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0]! },
      { kind: 'photo', albumId: b.albumId, photoId: b.photoIds[0]! },
    ]);
    expect((await getCart()).body.total).toBe(1200);
    await env.DB.prepare("UPDATE albums SET status = 'ended' WHERE id = ?").bind(a.albumId).run();
    const r = await checkout();
    expect(r.body.amount).toBe(700);
    expect(r.body.excludedItemIds).toHaveLength(1);
  });

  it('買えるものがなければ 409 cart_empty', async () => {
    const empty = await checkout();
    expect(empty.status).toBe(409);
    expect(empty.body.error.code).toBe('cart_empty');
    const a = await seedAlbum({ photos: 1 });
    await addItems([{ kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0]! }]);
    await env.DB.prepare("UPDATE album_photos SET status = 'hidden'").run();
    const none = await checkout();
    expect(none.status).toBe(409);
    expect(none.body.error.message).toContain('いま買える写真がありません');
  });

  it('同じ送信の印では、注文を二重に作らない', async () => {
    const a = await seedAlbum({ photos: 2 });
    await addItems(a.photoIds.map((photoId) => ({ kind: 'photo' as const, albumId: a.albumId, photoId })));
    const key = crypto.randomUUID();
    const first = await checkout(BUYER, { key });
    const second = await checkout(BUYER, { key });
    expect(second.status).toBe(200);
    expect(second.body.orderId).toBe(first.body.orderId);
    expect(second.body.checkoutUrl).toBe(first.body.checkoutUrl);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first<{ n: number }>();
    expect(n!.n).toBe(1);
    const row = await env.DB.prepare('SELECT request_key FROM orders').first<{ request_key: string }>();
    expect(row!.request_key).toMatch(new RegExp(`:${key}$`));
  });

  it('本物の Stripe には、1つの Checkout Session に複数の明細を送る(支払い方法はダッシュボードで選ぶ。金額はサーバーの値)', async () => {
    const a = await seedAlbum({ name: 'A', unitPrice: 500, albumPrice: 1500, photos: 2 });
    const b = await seedAlbum({ name: 'B', unitPrice: 800, photos: 1 });
    await addItems([
      { kind: 'photo', albumId: b.albumId, photoId: b.photoIds[0]! },
      { kind: 'album', albumId: a.albumId },
    ]);
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ id: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay/cs_test_123', expires_at: 1793674800 }), { status: 200 }),
    );
    const stripe = new LiveStripeClient('sk_test_x', fetcher as unknown as typeof fetch);
    const customer = await ensurePhotoCustomer(env.DB, { userId: 'U901', displayName: 'かい' }, new Date(NOW));
    const res = await createCheckout({ db: env.DB, stripe, customer, now: new Date(NOW), origin: 'https://dogrun.test', requestKey: null });
    expect(res).toMatchObject({ checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_123', amount: 2300 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://api.stripe.com/v1/checkout/sessions');
    const headers = init!.headers as Record<string, string>;
    expect(headers['stripe-version']).toBe(STRIPE_API_VERSION);
    expect(headers['idempotency-key']).toBe(`photo-order-${res.orderId}`);
    const form = new URLSearchParams(String(init!.body));
    expect(form.get('mode')).toBe('payment');
    expect(form.get('metadata[order_id]')).toBe(String(res.orderId));
    expect(form.get('client_reference_id')).toBe(String(res.orderId));
    expect(form.get('success_url')).toBe(`https://dogrun.test/liff/photos/orders/${res.orderId}`);
    expect(form.get('cancel_url')).toBe('https://dogrun.test/liff/photos/cart');
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('800');
    expect(form.get('line_items[0][price_data][currency]')).toBe('jpy');
    expect(form.get('line_items[0][price_data][product_data][name]')).toMatch(/^B IMG_/);
    expect(form.get('line_items[1][price_data][unit_amount]')).toBe('1500');
    expect(form.get('line_items[1][price_data][product_data][name]')).toBe('A まるごと(2枚)');
    expect(form.has('line_items[2][quantity]')).toBe(false);
    // 支払い方法(カード・Apple Pay・Google Pay・PayPay)はコードで固定しない
    expect([...form.keys()].some((k) => k.startsWith('payment_method_types'))).toBe(false);
    const order = await env.DB.prepare('SELECT payment_mode, stripe_session_id FROM orders WHERE id = ?').bind(res.orderId).first();
    expect(order).toEqual({ payment_mode: 'live', stripe_session_id: 'cs_test_123' });
  });

  it('Stripe につながらなければ、注文を閉じて 502(カートはそのまま)', async () => {
    const a = await seedAlbum({ photos: 1 });
    await addItems([{ kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0]! }]);
    const stripe = new LiveStripeClient('sk_test_x', (async () => new Response('{"error":{"message":"x"}}', { status: 500 })) as unknown as typeof fetch);
    const customer = await ensurePhotoCustomer(env.DB, { userId: 'U901', displayName: 'かい' }, new Date(NOW));
    await expect(createCheckout({ db: env.DB, stripe, customer, now: new Date(NOW), origin: 'https://dogrun.test', requestKey: null })).rejects.toMatchObject({ status: 502 });
    const order = await env.DB.prepare('SELECT status FROM orders').first<{ status: string }>();
    expect(order!.status).toBe('expired');
    expect((await getCart()).body.items).toHaveLength(1);
  });
});

describe('自分の注文(PU-6)', () => {
  it('お支払い待ちのあいだは pending。完了の URL を開いただけでは確定しない', async () => {
    const a = await seedAlbum({ photos: 1 });
    await addItems([{ kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0]! }]);
    const co = await checkout();
    // success_url(LIFF の購入完了の画面)が読むのは、この API だけ。読んでも確定しない
    for (let i = 0; i < 2; i++) {
      const r = await call(`/api/photos/orders/${co.body.orderId}`, { user: BUYER });
      expect(r.body.order).toMatchObject({ id: co.body.orderId, status: 'pending', paidAt: null });
    }
    const ent = await env.DB.prepare('SELECT COUNT(*) AS n FROM entitlements').first<{ n: number }>();
    expect(ent!.n).toBe(0);
  });

  it('ほかの人の注文は見えない(404・一覧にも出ない)', async () => {
    const a = await seedAlbum({ photos: 2 });
    const mine = await buy([{ kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0]! }]);
    const theirs = await buy([{ kind: 'photo', albumId: a.albumId, photoId: a.photoIds[1]! }], OTHER);
    expect((await call(`/api/photos/orders/${theirs}`, { user: BUYER })).status).toBe(404);
    const list = await call('/api/photos/orders', { user: BUYER });
    expect(list.body.orders.map((o: any) => o.id)).toEqual([mine]);
    const one = await call(`/api/photos/orders/${mine}`, { user: BUYER });
    expect(one.body.order).toMatchObject({ status: 'paid', amount: 500, lines: [{ kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0], unitPrice: 500 }] });
    expect(one.body.order.lines[0].label).toMatch(/^IMG_/);
  });
});
