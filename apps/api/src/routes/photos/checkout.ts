import { checkoutSchema, cartAddSchema, type CartResponse } from '@dr/shared';
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { originOf, requireStripe } from '../../lib/photos/availability';
import { ensurePhotoCustomer } from '../../lib/photos/customers';
import { parseJson } from '../../lib/validate';
import { addToCart, createCheckout, evaluateCart, myOrders, removeCartItem } from '../../services/photos/checkout';

// 段階1-C(決済)。PU-5 カート・PU-6 購入完了(PF-6)
// 金額はサーバーが DB から計算する(リクエストの金額・名前は使わない)。販売終了・非公開・購入済みは、カートの見積もりと購入手続きの両方で弾く。
// Stripe は requireStripe(c)(本番は本物、local・test はまね)。success_url・cancel_url は photoSuccessUrl・photoCancelUrl。
// 注文の確定は webhook.ts だけ(完了の画面では確定しない)。
export const checkoutRoutes = new Hono<AppEnv>();

const customerOf = (c: Context<AppEnv>) => ensurePhotoCustomer(c.env.DB, c.get('lineUser'), c.get('now'));
const positiveId = (raw: string | undefined) => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw errors.notFound();
  return n;
};

// カートの中身(→ CartResponse)。見るたびに DB から価格と買えるかを調べる
checkoutRoutes.get('/cart', async (c) => {
  const customer = await customerOf(c);
  const { cart } = await evaluateCart(c.env.DB, customer.id, c.get('now'));
  return c.json<CartResponse>(cart);
});

// 複数をまとめて入れる(cartAddSchema → CartAddResponse)。同じ写真(ほかのアルバムからでも)・同じまるごとは1つだけ
checkoutRoutes.post('/cart/items', async (c) => {
  const input = await parseJson(c, cartAddSchema);
  const customer = await customerOf(c);
  return c.json(await addToCart(c.env.DB, customer.id, input.items, c.get('now')));
});

// 1行ずつ外す(removed_at を入れる。→ CartResponse)
checkoutRoutes.delete('/cart/items/:itemId', async (c) => {
  const customer = await customerOf(c);
  await removeCartItem(c.env.DB, customer.id, positiveId(c.req.param('itemId')), c.get('now'));
  const { cart } = await evaluateCart(c.env.DB, customer.id, c.get('now'));
  return c.json<CartResponse>(cart);
});

// 購入手続き(checkoutSchema = {} → CheckoutResponse)。カートの ok の行を1つの注文・1つの Checkout Session(明細は複数)にする。
// 送信の印(Idempotency-Key)で二重に注文を作らない(orders.request_key)。カートの行は、お支払いの確定(webhook)まで残す
checkoutRoutes.post('/checkout', async (c) => {
  // 本文は空でよい(金額・品物は送らない。送られても使わない)
  const text = await c.req.text();
  if (text.trim()) {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw errors.badRequest('送られた内容を読み取れませんでした。画面を読み込み直して、もう一度お試しください。');
    }
    checkoutSchema.parse(body ?? {});
  }
  const stripe = requireStripe(c);
  const customer = await customerOf(c);
  return c.json(
    await createCheckout({
      db: c.env.DB,
      stripe,
      customer,
      now: c.get('now'),
      origin: originOf(c),
      requestKey: c.req.header('idempotency-key') ?? null,
    }),
  );
});

// 自分の注文(→ { orders: MyOrder[] })・1件(→ { order: MyOrder })。処理中(pending)なら画面は「処理中」で読み直す
checkoutRoutes.get('/orders', async (c) => {
  const customer = await customerOf(c);
  return c.json({ orders: await myOrders(c.env.DB, customer.id) });
});
checkoutRoutes.get('/orders/:id', async (c) => {
  const customer = await customerOf(c);
  const [order] = await myOrders(c.env.DB, customer.id, positiveId(c.req.param('id')));
  if (!order) throw errors.notFound('注文が見つかりませんでした。「購入した写真」の画面から開き直してください。');
  return c.json({ order });
});
