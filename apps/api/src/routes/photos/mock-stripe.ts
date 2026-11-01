import { photoSuccessUrl, photoCancelUrl } from '@dr/shared';
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { originOf } from '../../lib/photos/availability';
import { ensurePhotoCustomer } from '../../lib/photos/customers';
import { mockCompletedSession, mockStripeEvent, signStripePayload, stripeMockEnabled, webhookSecret } from '../../lib/photos/stripe';
import { receiveStripeWebhook } from './webhook';

// まねの Stripe(local・test で STRIPE_MOCK = "1" のときだけ。docs/photo-requirements.md 8.3。段階0・統合の担当のファイル)
// LIFF のまねの支払いの画面(/liff/photos/mock-checkout/:sessionId。PU-5 の一部・段階1-C)から呼ぶ。
// 「支払う」は、本物と同じ形の checkout.session.completed を本物と同じ方法で署名し、Webhook の口(webhook.ts)にそのまま渡す。
// 注文が自分のもので、お支払い待ち(pending)のときだけ。本番では 404。
export const mockStripeRoutes = new Hono<AppEnv>();

type OrderRow = { id: number; customer_id: number; status: string; amount: number; stripe_session_id: string };

async function ownPendingOrder(c: Context<AppEnv>): Promise<OrderRow> {
  if (!stripeMockEnabled(c.env)) throw errors.notFound();
  const customer = await ensurePhotoCustomer(c.env.DB, c.get('lineUser'), c.get('now'));
  const order = await c.env.DB.prepare(
    "SELECT id, customer_id, status, amount, stripe_session_id FROM orders WHERE stripe_session_id = ? AND payment_mode = 'mock'",
  )
    .bind(c.req.param('sessionId'))
    .first<OrderRow>();
  if (!order || order.customer_id !== customer.id) throw errors.notFound('お支払いの画面が見つかりませんでした。カートからやり直してください。');
  return order;
}

// まねの支払いの画面の中身
mockStripeRoutes.get('/mock-stripe/sessions/:sessionId', async (c) => {
  const order = await ownPendingOrder(c);
  const { results } = await c.env.DB.prepare('SELECT label, unit_price FROM order_items WHERE order_id = ? ORDER BY id')
    .bind(order.id)
    .all<{ label: string; unit_price: number }>();
  return c.json({
    orderId: order.id,
    status: order.status,
    amount: order.amount,
    lines: results.map((r) => ({ label: r.label, unitPrice: r.unit_price })),
    successUrl: photoSuccessUrl(originOf(c), order.id),
    cancelUrl: photoCancelUrl(originOf(c)),
  });
});

// 「支払う」: 署名つきのまねの Webhook を送り、戻り先を返す
mockStripeRoutes.post('/mock-stripe/sessions/:sessionId/pay', async (c) => {
  const order = await ownPendingOrder(c);
  if (order.status !== 'pending') throw errors.conflict('order_not_pending', 'この注文は、もうお支払いが済んでいるか、期限が切れています。');
  const now = c.get('now');
  const event = mockStripeEvent('checkout.session.completed', mockCompletedSession({ sessionId: order.stripe_session_id, orderId: order.id, amount: order.amount }), now);
  const payload = JSON.stringify(event);
  const signature = await signStripePayload(webhookSecret(c.env)!, payload, now);
  // 本物と同じ道(署名の確かめ → handleStripeEvent)を通す
  const res = await receiveStripeWebhook(c, payload, signature);
  return c.json({ webhookStatus: res.status, eventId: event.id, redirectUrl: photoSuccessUrl(originOf(c), order.id) }, res.ok ? 200 : 502);
});

// 「やめる」: 何もせず、カートに戻る(本物の Stripe も、やめただけでは知らせない。期限で expired になる)
mockStripeRoutes.post('/mock-stripe/sessions/:sessionId/cancel', async (c) => {
  await ownPendingOrder(c);
  return c.json({ redirectUrl: photoCancelUrl(originOf(c)) });
});
