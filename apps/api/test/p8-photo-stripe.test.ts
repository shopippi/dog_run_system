import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  LiveStripeClient,
  MOCK_WEBHOOK_SECRET,
  MockStripeClient,
  mockCompletedSession,
  mockStripeEvent,
  orderIdFromMockSession,
  signStripePayload,
  stripeClient,
  stripeMockEnabled,
  toFormBody,
  verifyStripeSignature,
  webhookSecret,
} from '../src/lib/photos/stripe';
import { BASE, call } from './helpers';

// Stripe(docs/photo-requirements.md 8章)。本物の Stripe は呼ばない(fetch のまね・まねの Stripe)

const NOW = new Date('2026-11-04T00:00:00Z');

describe('Webhook の署名(Web Crypto)', () => {
  // Node の crypto.createHmac で作った値(Stripe の公式のライブラリと同じ計算)
  const payload = '{"id":"evt_test","type":"checkout.session.completed"}';
  const header = 't=1793750400,v1=8f9ef9f28123dd3a289ef2d64291dd6e8f50d222d0cc0f991227aa87a4b72fb5';

  it('正しい署名を受け付ける', async () => {
    expect(await verifyStripeSignature({ payload, header, secret: 'whsec_test_secret', now: NOW })).toEqual({ ok: true });
  });
  it('本文・秘密が違えば受け付けない', async () => {
    expect(await verifyStripeSignature({ payload: payload + ' ', header, secret: 'whsec_test_secret', now: NOW })).toEqual({ ok: false, reason: 'mismatch' });
    expect(await verifyStripeSignature({ payload, header, secret: 'whsec_other', now: NOW })).toEqual({ ok: false, reason: 'mismatch' });
  });
  it('5分より古い(新しい)署名は受け付けない', async () => {
    const late = new Date(NOW.getTime() + 301_000);
    expect(await verifyStripeSignature({ payload, header, secret: 'whsec_test_secret', now: late })).toEqual({ ok: false, reason: 'too_old' });
    const early = new Date(NOW.getTime() - 301_000);
    expect(await verifyStripeSignature({ payload, header, secret: 'whsec_test_secret', now: early })).toEqual({ ok: false, reason: 'too_old' });
  });
  it('v1 が複数あれば、どれか1つが合えばよい。形が違えば受け付けない', async () => {
    const two = `t=1793750400,v1=${'0'.repeat(64)},v1=8f9ef9f28123dd3a289ef2d64291dd6e8f50d222d0cc0f991227aa87a4b72fb5`;
    expect(await verifyStripeSignature({ payload, header: two, secret: 'whsec_test_secret', now: NOW })).toEqual({ ok: true });
    expect(await verifyStripeSignature({ payload, header: null, secret: 's', now: NOW })).toEqual({ ok: false, reason: 'missing' });
    expect(await verifyStripeSignature({ payload, header: 'v0=abc', secret: 's', now: NOW })).toEqual({ ok: false, reason: 'malformed' });
  });
  it('まねの Stripe の署名は、同じ確かめ方で通る', async () => {
    const event = mockStripeEvent('checkout.session.completed', mockCompletedSession({ sessionId: 'cs_mock_1_0123456789abcdef', orderId: 1, amount: 1300 }), NOW);
    const body = JSON.stringify(event);
    const sig = await signStripePayload(MOCK_WEBHOOK_SECRET, body, NOW);
    expect(sig).toMatch(/^t=1793750400,v1=[0-9a-f]{64}$/);
    expect(await verifyStripeSignature({ payload: body, header: sig, secret: MOCK_WEBHOOK_SECRET, now: NOW })).toEqual({ ok: true });
    expect(event).toMatchObject({ type: 'checkout.session.completed', livemode: false, data: { object: { amount_total: 1300, currency: 'jpy', metadata: { order_id: '1' }, payment_status: 'paid' } } });
  });
});

describe('Stripe の窓口', () => {
  it('フォームの形(入れ子・配列)', () => {
    expect(toFormBody({ mode: 'payment', line_items: [{ quantity: 1, price_data: { currency: 'jpy', unit_amount: 500, product_data: { name: '写真 1' } } }], skip: undefined })).toBe(
      'mode=payment&line_items%5B0%5D%5Bquantity%5D=1&line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=jpy&line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=500&line_items%5B0%5D%5Bprice_data%5D%5Bproduct_data%5D%5Bname%5D=%E5%86%99%E7%9C%9F%201',
    );
  });

  it('本物: Checkout の作成は、鍵・版・送信の印を付けて Stripe の API に送る(fetch のまね)', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetcher = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return Response.json({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1', expires_at: 1793752200 });
    }) as unknown as typeof fetch;
    const s = new LiveStripeClient('sk_test_x', fetcher);
    const r = await s.createCheckoutSession({ orderId: 7, lines: [{ name: '写真', amount: 500 }], successUrl: 'https://x/ok', cancelUrl: 'https://x/ng', idempotencyKey: 'order-7', origin: 'https://x' });
    expect(r).toEqual({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1', expiresAt: 1793752200 });
    const h = seen!.init.headers as Record<string, string>;
    expect(seen!.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(h.authorization).toBe('Bearer sk_test_x');
    expect(h['idempotency-key']).toBe('order-7');
    expect(String(seen!.init.body)).toContain('metadata%5Border_id%5D=7');
    expect(String(seen!.init.body)).toContain('unit_amount%5D=500');
  });

  it('本物: Stripe のエラーは StripeError', async () => {
    const fetcher = (async () => Response.json({ error: { code: 'amount_too_small', message: 'too small' } }, { status: 400 })) as unknown as typeof fetch;
    await expect(new LiveStripeClient('sk', fetcher).createRefund({ paymentIntent: 'pi', amount: 1, idempotencyKey: 'k', orderId: 1 })).rejects.toMatchObject({
      status: 400,
      stripeCode: 'amount_too_small',
    });
  });

  it('まね: LIFF のまねの支払いの画面へ移る。番号から注文が分かる', async () => {
    const s = await new MockStripeClient().createCheckoutSession({ orderId: 12, lines: [], successUrl: '', cancelUrl: '', idempotencyKey: 'k', origin: 'https://dogrun.test' });
    expect(s.url).toBe(`https://dogrun.test/liff/photos/mock-checkout/${s.id}`);
    expect(orderIdFromMockSession(s.id)).toBe(12);
    expect(orderIdFromMockSession('cs_live_abc')).toBeNull();
  });

  it('まねは local・test で STRIPE_MOCK = "1" のときだけ。本番では決して使わない', () => {
    expect(stripeMockEnabled({ ENVIRONMENT: 'test', STRIPE_MOCK: '1' })).toBe(true);
    expect(stripeMockEnabled({ ENVIRONMENT: 'local', STRIPE_MOCK: '0' })).toBe(false);
    expect(stripeMockEnabled({ ENVIRONMENT: 'production', STRIPE_MOCK: '1' })).toBe(false);
    expect(stripeClient(env)?.mode).toBe('mock');
    expect(stripeClient({ ...env, ENVIRONMENT: 'production' })).toBeNull();
    expect(stripeClient({ ...env, ENVIRONMENT: 'production', STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh' })?.mode).toBe('live');
    expect(webhookSecret({ ...env, ENVIRONMENT: 'production' })).toBeNull();
    expect(webhookSecret(env)).toBe(MOCK_WEBHOOK_SECRET);
  });
});

describe('Webhook の口(POST /api/photos/stripe/webhook)', () => {
  const post = async (body: string, signature?: string) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-debug-now': NOW.toISOString() };
    if (signature) headers['stripe-signature'] = signature;
    const { SELF } = await import('cloudflare:test');
    const res = await SELF.fetch(`${BASE}/api/photos/stripe/webhook`, { method: 'POST', headers, body });
    return { status: res.status, body: (await res.json()) as { error?: { code: string } } };
  };

  it('署名がない・合わないものは 400。LINE のログインは要らない', async () => {
    const body = JSON.stringify(mockStripeEvent('checkout.session.completed', {}, NOW));
    expect((await post(body)).status).toBe(400);
    expect((await post(body, await signStripePayload('whsec_wrong', body, NOW))).body.error?.code).toBe('bad_signature');
  });

  it('署名が合えば、イベントの処理(段階1-C)へ進む', async () => {
    const body = JSON.stringify(mockStripeEvent('checkout.session.completed', {}, NOW));
    const r = await post(body, await signStripePayload(MOCK_WEBHOOK_SECRET, body, NOW));
    expect(r.status).not.toBe(400);
    expect(r.status).not.toBe(401);
  });

  it('まねの支払いの口は、ほかの人の注文には使えない', async () => {
    const res = await call('/api/photos/mock-stripe/sessions/cs_mock_1_0123456789abcdef', { user: 'U900:だれか' });
    // 販売が止まっている(初期値)ので準備中
    expect(res.status).toBe(503);
  });
});
