import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { notImplemented } from '../../lib/photos/availability';

// 段階1-C(決済)。PU-5 カート・PU-6 購入完了(PF-6)
// 金額はサーバーが DB から計算する(リクエストの金額・名前は使わない)。販売終了・非公開・購入済みは、カートの見積もりと購入手続きの両方で弾く。
// Stripe は requireStripe(c)(本番は本物、local・test はまね)。success_url・cancel_url は photoSuccessUrl・photoCancelUrl。
// 注文の確定は webhook.ts だけ(完了の画面では確定しない)。
export const checkoutRoutes = new Hono<AppEnv>();

const todo = async (): Promise<never> => {
  throw notImplemented();
};

// カートはサーバー側(cart_items。購入者ごと。LIFF を開き直しても、別の端末でも同じ)。見るたびに DB から価格と買えるかを調べ、
// cartLineStates で行ごとに ok / redundant(まるごとに含まれる。請求しない) / unavailable(販売終了・非公開・購入済み。除く)を付ける。
// カートの中身(→ CartResponse)
checkoutRoutes.get('/cart', todo);
// 複数をまとめて入れる(cartAddSchema → CartAddResponse)。同じ写真(ほかのアルバムからでも)・同じまるごとは1つだけ
checkoutRoutes.post('/cart/items', todo);
// 1行ずつ外す(removed_at を入れる。→ CartResponse)
checkoutRoutes.delete('/cart/items/:itemId', todo);
// 購入手続き(checkoutSchema = {} → CheckoutResponse)。カートの ok の行を1つの注文・1つの Checkout Session(明細は複数)にする。
// 送信の印(Idempotency-Key)で二重に注文を作らない。お支払いが確定したら(webhook)、その行に ordered_at・order_id を入れる
checkoutRoutes.post('/checkout', todo);
// 自分の注文(→ { orders: MyOrder[] })・1件(→ { order: MyOrder })。処理中(pending)なら画面は「処理中」
checkoutRoutes.get('/orders', todo);
checkoutRoutes.get('/orders/:id', todo);
