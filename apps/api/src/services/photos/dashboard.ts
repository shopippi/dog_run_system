import {
  toJstIso,
  type AdminOrderSummary,
  type OrderStatus,
  type PhotoAvailability,
  type PhotoDashboardResponse,
  type Settings,
} from '@dr/shared';
import type { Bindings } from '../../env';
import { photoAvailability } from '../../lib/photos/availability';
import { loadSettings } from '../../lib/settings';

// 段階1-D(配信)。PA-1 写真販売のダッシュボードと、PA-7 写真販売の設定の確かめ。
// 売上は明細ではなく注文から: お支払いの確定した月で数え、返金した額を引く(残高の列は持たない。orders.refunded_amount は明細の写し)。

const DAY_MS = 24 * 3600_000;
/** 最新の注文に出す数 */
const RECENT_ORDERS = 8;

type OrderRow = {
  id: number;
  status: OrderStatus;
  amount: number;
  refunded_amount: number;
  paid_at: string | null;
  created_at: string;
  payment_mode: 'live' | 'mock';
  display_name: string | null;
  member_no: string | null;
  item_count: number;
};

const toSummary = (r: OrderRow): AdminOrderSummary => ({
  id: r.id,
  status: r.status,
  amount: r.amount,
  refundedAmount: r.refunded_amount,
  paidAt: r.paid_at,
  createdAt: r.created_at,
  customerName: r.display_name,
  memberNo: r.member_no,
  itemCount: r.item_count,
  paymentMode: r.payment_mode,
});

/** 知らせること: ハッシュが合わなかった写真、直近の窓でダウンロードの上限に達した写真(人 × 写真) */
export async function photoAlerts(db: D1Database, now: Date, limit: Settings['photo_download_limit']): Promise<{ hashMismatchPhotos: number; downloadLimitHits: number }> {
  const since = toJstIso(new Date(now.getTime() - limit.hours * 3600_000));
  const [hash, hits] = await db.batch<{ n: number }>([
    db.prepare('SELECT COUNT(*) AS n FROM photos WHERE hash_mismatch_at IS NOT NULL AND files_deleted_at IS NULL'),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM (SELECT customer_id, photo_id FROM download_logs WHERE created_at > ?
          GROUP BY customer_id, photo_id HAVING COUNT(*) >= ?)`,
      )
      .bind(since, limit.count),
  ]);
  return { hashMismatchPhotos: hash!.results[0]?.n ?? 0, downloadLimitHits: hits!.results[0]?.n ?? 0 };
}

/** GET /admin/api/photos/dashboard */
export async function photoDashboard(env: Bindings, now: Date): Promise<PhotoDashboardResponse> {
  const db = env.DB;
  const settings = await loadSettings(db);
  const month = toJstIso(now).slice(0, 7);
  const [sales, sold, recent, live] = await db.batch([
    db
      .prepare(
        `SELECT COALESCE(SUM(amount - refunded_amount), 0) AS yen, COUNT(*) AS n FROM orders
          WHERE status IN ('paid', 'refunded', 'partially_refunded') AND paid_at IS NOT NULL AND substr(paid_at, 1, 7) = ?`,
      )
      .bind(month),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM entitlements e JOIN order_items oi ON oi.id = e.order_item_id JOIN orders o ON o.id = oi.order_id
          WHERE e.revoked_at IS NULL AND o.paid_at IS NOT NULL AND substr(o.paid_at, 1, 7) = ?`,
      )
      .bind(month),
    db
      .prepare(
        `SELECT o.id, o.status, o.amount, o.refunded_amount, o.paid_at, o.created_at, o.payment_mode,
                c.display_name, h.member_no,
                (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
           FROM orders o
           JOIN photo_customers c ON c.id = o.customer_id
           LEFT JOIN households h ON h.id = COALESCE(o.household_id, c.household_id)
          WHERE o.status IN ('paid', 'refunded', 'partially_refunded')
          ORDER BY COALESCE(o.paid_at, o.created_at) DESC, o.id DESC
          LIMIT ?`,
      )
      .bind(RECENT_ORDERS),
    db.prepare(
      `SELECT a.id, a.name, a.sale_ends_at,
              (SELECT COUNT(*) FROM album_photos ap JOIN photos p ON p.id = ap.photo_id
                WHERE ap.album_id = a.id AND ap.status <> 'removed' AND p.files_deleted_at IS NULL
                  AND NOT EXISTS (SELECT 1 FROM entitlements e WHERE e.photo_id = p.id AND e.revoked_at IS NULL)) AS unsold
         FROM albums a WHERE a.status = 'published' AND a.sale_ends_at IS NOT NULL ORDER BY a.sale_ends_at, a.id`,
    ),
  ]);
  const s = sales!.results[0] as { yen: number; n: number };
  const until = now.getTime() + settings.photo_deletion_notice_days * DAY_MS;
  const endingSoon = (live!.results as { id: number; name: string; sale_ends_at: string; unsold: number }[])
    .filter((a) => {
      const t = new Date(a.sale_ends_at).getTime();
      return t > now.getTime() && t <= until;
    })
    .map((a) => ({ albumId: a.id, name: a.name, saleEndsAt: a.sale_ends_at, unsoldPhotos: a.unsold }));
  return {
    month,
    salesYen: s.yen,
    soldPhotos: (sold!.results[0] as { n: number }).n,
    orders: s.n,
    endingSoon,
    recentOrders: (recent!.results as OrderRow[]).map(toSummary),
    availability: photoAvailability(env, settings),
  };
}

/**
 * PA-7: 写真販売の設定を変える前の確かめ。「販売する」は、写真の置き場所とお支払いの設定がそろっていなければ選べない。
 * 問題がなければ null。設定の API(routes/admin/settings.ts)から呼ぶ(統合の担当に依頼)。画面も同じ理由で押せなくする
 */
export function checkPhotoSettingsPatch(env: Bindings, patch: Partial<Settings>): string | null {
  if (patch.photo_sales_enabled !== true) return null;
  const a: PhotoAvailability = photoAvailability(env, { photo_sales_enabled: true });
  if (a.storage === 'missing' || a.payments === 'missing') return a.message;
  return null;
}
