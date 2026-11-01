import { Hono, type Context } from 'hono';
import type { AppEnv } from '../../env';
import { AppError } from '../../lib/errors';
import { notImplemented } from '../../lib/photos/availability';
import { verifyStripeSignature, webhookSecret } from '../../lib/photos/stripe';

// 段階1-C(決済)。Stripe の Webhook(POST /api/photos/stripe/webhook。認証なし、署名で守る)
// 署名の確かめ(このファイルの上半分)は段階0で決めた。段階1-C は handleStripeEvent を作る:
// - webhook_events に stripe_event_id を入れてから処理する(同じイベントが何回届いても1回だけ)
// - checkout.session.completed: 注文を paid に、権利(entitlements)を作る(まるごとは albumEntitlementPhotoIds)、
//   原本を購入済み領域へコピーして SHA-256 を確かめる(storage.copy・storage.sha256)、購入完了の LINE のお知らせ
// - checkout.session.expired: 注文を expired に
// - charge.refunded: 返金した明細の権利を無効に(管理画面からの返金と二重にならないように)
export const webhookRoutes = new Hono<AppEnv>();

export type StripeEvent = { id: string; type: string; created: number; livemode: boolean; data: { object: Record<string, unknown> } };

/** 署名を確かめたイベントを処理する(段階1-C) */
export async function handleStripeEvent(_c: Context<AppEnv>, _event: StripeEvent): Promise<Response> {
  throw notImplemented();
}

/**
 * Webhook を受け取る(署名を確かめてから handleStripeEvent へ)。まねの Stripe(mock-stripe.ts)も、同じ道を通す。
 * payload は受け取ったままの本文(JSON にしてから戻すと署名が合わない)
 */
export async function receiveStripeWebhook(c: Context<AppEnv>, payload: string, signatureHeader: string | undefined): Promise<Response> {
  const secret = webhookSecret(c.env);
  if (!secret) throw new AppError(503, 'payments_not_configured', 'お支払いの設定がまだです。');
  const check = await verifyStripeSignature({ payload, header: signatureHeader, secret, now: c.get('now') });
  if (!check.ok) throw new AppError(400, 'bad_signature', `署名を確かめられませんでした(${check.reason})。`);
  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    throw new AppError(400, 'bad_payload', '内容を読み取れませんでした。');
  }
  if (!event?.id || !event.type) throw new AppError(400, 'bad_payload', '内容を読み取れませんでした。');
  return handleStripeEvent(c, event);
}

webhookRoutes.post('/stripe/webhook', async (c) => receiveStripeWebhook(c, await c.req.text(), c.req.header('stripe-signature')));
