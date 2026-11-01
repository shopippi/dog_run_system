import { adminOrdersQuerySchema, refundSchema } from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { requireStripe } from '../../lib/photos/availability';
import { loadSettings } from '../../lib/settings';
import { parseInput, parseJson } from '../../lib/validate';
import { listOrders, orderDetail, refundOrder } from '../../services/photos/refund';

// 段階1-C(決済)。PA-6 注文・返金
// 返金は購入から photo_refund_days 日以内で、ダウンロードしていない明細だけ(refundEligibility)。
// 条件の外は override = true と理由(管理者だけ。audit_log の reason に残す)。返金した明細の権利は revoked_at を入れる。
// 権限: index.ts の requireRole('admin')(受付は 403)と requireStaff(製作者は変更が 403)
export const adminOrderRoutes = new Hono<AppEnv>();

const orderId = (raw: string | undefined) => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw errors.notFound('注文が見つかりませんでした。注文の一覧から開き直してください。');
  return n;
};

// 一覧(adminOrdersQuerySchema → AdminOrdersResponse)
adminOrderRoutes.get('/orders', async (c) => {
  const q = parseInput(adminOrdersQuerySchema, c.req.query());
  return c.json(await listOrders(c.env.DB, q));
});

// 内容(明細・返金できるか・ダウンロードの記録)(→ AdminOrderDetail)
adminOrderRoutes.get('/orders/:id', async (c) => {
  const settings = await loadSettings(c.env.DB);
  return c.json(await orderDetail(c.env.DB, orderId(c.req.param('id')), c.get('now'), settings.photo_refund_days));
});

// 返金(refundSchema → RefundResponse)
adminOrderRoutes.post('/orders/:id/refund', async (c) => {
  const id = orderId(c.req.param('id'));
  const input = await parseJson(c, refundSchema);
  const settings = await loadSettings(c.env.DB);
  return c.json(
    await refundOrder({
      db: c.env.DB,
      stripe: requireStripe(c),
      orderId: id,
      input,
      staffId: c.get('staff').id,
      now: c.get('now'),
      refundDays: settings.photo_refund_days,
    }),
  );
});
