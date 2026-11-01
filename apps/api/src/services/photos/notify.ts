import { PHOTO_LIFF_PATHS, bookingMonthOf, formatPhotoPrice, toJstIso } from '@dr/shared';
import type { Bindings } from '../../env';
import { loadSettings } from '../../lib/settings';
import { LINE_SENT_IN_MONTH_SQL, transportFor, type PushTransport } from '../line-push';

// 購入完了の LINE のお知らせ(docs/photo-requirements.md 3.6。段階1-C)
// - 送り方は予約のお知らせ(services/line-push.ts)と同じ。本番だけ LINE に送り、local・test は「送ったつもり」(reason = mock)
// - ひと月の上限は、予約のお知らせと合わせて数える(LINE_SENT_IN_MONTH_SQL)。送る前に条件つきの INSERT で1通分の枠を取る
// - 送れなくても注文は止めない。結果を photo_notifications に残す。同じ注文には1回だけ(Webhook の送り直しで二重に送らない)

export type PhotoNotifyStatus = 'sent' | 'skipped' | 'failed';

/** お知らせの文 */
export function purchaseMessageText(args: { facilityName: string; photoCount: number; amount: number; link: string | null }): string {
  const lines = [
    `【${args.facilityName}】写真の購入が完了しました`,
    `ご購入ありがとうございます。写真${args.photoCount}枚(合計 ${formatPhotoPrice(args.amount)})のお支払いを確認しました。`,
    '購入した写真は「購入した写真」の画面から、いつでも見たり保存したりできます。',
  ];
  if (args.link) lines.push('', `購入した写真: ${args.link}`);
  return lines.join('\n');
}

export async function notifyPurchase(
  env: Pick<Bindings, 'DB' | 'ENVIRONMENT' | 'LINE_MESSAGING_TOKEN'>,
  orderId: number,
  now: Date,
  transport: PushTransport = transportFor(env),
): Promise<{ status: PhotoNotifyStatus; reason: string | null }> {
  const db = env.DB;
  try {
    // 同じ注文には1回だけ(送れた・送らなかったのどちらでも、記録があれば何もしない)
    const done = await db.prepare("SELECT status, reason FROM photo_notifications WHERE order_id = ? AND kind = 'purchase_complete' LIMIT 1").bind(orderId).first<{ status: PhotoNotifyStatus; reason: string | null }>();
    if (done) return done;
    const settings = await loadSettings(db);
    const order = await db
      .prepare(
        `SELECT o.id, o.customer_id, o.amount, c.line_user_id,
                (SELECT COUNT(*) FROM entitlements e JOIN order_items oi ON oi.id = e.order_item_id WHERE oi.order_id = o.id) AS photos
           FROM orders o JOIN photo_customers c ON c.id = o.customer_id WHERE o.id = ?`,
      )
      .bind(orderId)
      .first<{ id: number; customer_id: number; amount: number; line_user_id: string | null; photos: number }>();
    if (!order) return { status: 'skipped', reason: 'no_order' };
    const link = settings.liff_id ? `https://liff.line.me/${settings.liff_id}${PHOTO_LIFF_PATHS.purchases}` : null;
    const text = purchaseMessageText({ facilityName: settings.facility_name, photoCount: order.photos, amount: order.amount, link });
    const month = bookingMonthOf(now);
    const nowIso = toJstIso(now);
    const record = async (status: PhotoNotifyStatus, reason: string | null, detail: string | null = null) => {
      await db
        .prepare(
          `INSERT INTO photo_notifications (order_id, customer_id, kind, status, reason, detail, message, month, created_at)
           VALUES (?, ?, 'purchase_complete', ?, ?, ?, ?, ?, ?)`,
        )
        .bind(order.id, order.customer_id, status, reason, detail, text, month, nowIso)
        .run();
      return { status, reason };
    };

    if (!settings.photo_notify_purchase) return record('skipped', 'disabled');
    if (!order.line_user_id) return record('skipped', 'no_recipient');
    const token = env.LINE_MESSAGING_TOKEN?.trim();
    if (!token) return record('skipped', 'no_token');
    // ひと月の上限(予約のお知らせと合わせて)。送る前に1通分の枠を取る(同時に送っても上限を超えない)
    const reserved = await db
      .prepare(
        `INSERT INTO photo_notifications (order_id, customer_id, kind, status, reason, detail, message, month, created_at)
         SELECT ?1, ?2, 'purchase_complete', 'sent', NULL, NULL, ?3, ?4, ?5
          WHERE ${LINE_SENT_IN_MONTH_SQL.replaceAll('?1', '?4')} < ?6
         ON CONFLICT DO NOTHING
         RETURNING id`,
      )
      .bind(order.id, order.customer_id, text, month, nowIso, settings.booking_notify.monthly_limit)
      .first<{ id: number }>();
    if (!reserved) return record('skipped', 'monthly_limit');
    const r = await transport(token, order.line_user_id, text);
    if (r.ok) {
      if (r.mock) await db.prepare("UPDATE photo_notifications SET reason = 'mock' WHERE id = ?").bind(reserved.id).run();
      return { status: 'sent', reason: r.mock ? 'mock' : null };
    }
    await db.prepare("UPDATE photo_notifications SET status = 'failed', reason = ?, detail = ? WHERE id = ?").bind(r.reason, r.detail, reserved.id).run();
    return { status: 'failed', reason: r.reason };
  } catch (e) {
    console.error('購入完了のお知らせを記録できませんでした', e);
    return { status: 'failed', reason: 'internal' };
  }
}
