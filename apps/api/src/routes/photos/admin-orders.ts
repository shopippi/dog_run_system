import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { notImplemented } from '../../lib/photos/availability';

// 段階1-C(決済)。PA-6 注文・返金
// 返金は購入から photo_refund_days 日以内で、ダウンロードしていない明細だけ(refundEligibility)。
// 条件の外は override = true と理由(管理者だけ。audit_log の reason に残す)。返金した明細の権利は revoked_at を入れる。
export const adminOrderRoutes = new Hono<AppEnv>();

const todo = async (): Promise<never> => {
  throw notImplemented();
};

// 一覧(adminOrdersQuerySchema → AdminOrdersResponse)
adminOrderRoutes.get('/orders', todo);
// 内容(明細・返金できるか・ダウンロードの記録)(→ AdminOrderDetail)
adminOrderRoutes.get('/orders/:id', todo);
// 返金(refundSchema → RefundResponse)
adminOrderRoutes.post('/orders/:id/refund', todo);
