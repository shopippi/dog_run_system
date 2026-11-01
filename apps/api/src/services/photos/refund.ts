import {
  PHOTO_ERROR_CODES,
  REFUND_BLOCK_MESSAGES,
  adminPhotoThumbUrl,
  refundEligibility,
  toJstIso,
  type AdminOrderDetail,
  type AdminOrderSummary,
  type AdminOrdersResponse,
  type OrderStatus,
  type RefundCheck,
  type RefundInput,
  type RefundResponse,
} from '@dr/shared';
import { AppError, errors } from '../../lib/errors';
import type { StripeClient } from '../../lib/photos/stripe';
import { auditStatement, latestAuditId } from '../audit';

// PA-6 注文・返金(docs/photo-requirements.md 3.5。段階1-C)
// - 返金できるのは、お支払いの確定から photo_refund_days 日以内で、その明細の写真を一度もダウンロードしていない明細(refundEligibility)
// - 条件の外は、管理者が「条件の外で返金する」(override)と理由を書いたときだけ。refund_override = 1、理由は audit_log に残す
// - Stripe の返金(明細ごとに送信の印)→ 明細に返金の日時・額 → 権利を無効に → 注文の状態と refunded_amount

const PAGE = 50;

type SummaryRow = {
  id: number;
  status: OrderStatus;
  amount: number;
  refunded_amount: number;
  paid_at: string | null;
  created_at: string;
  display_name: string | null;
  member_no: string | null;
  item_count: number;
  payment_mode: 'live' | 'mock';
  household_id: number | null;
  stripe_session_id: string | null;
  customer_id: number;
  stripe_payment_intent: string | null;
};

const SUMMARY_SELECT = `
  SELECT o.id, o.status, o.amount, o.refunded_amount, o.paid_at, o.created_at, o.payment_mode, o.household_id, o.stripe_session_id,
         o.customer_id, o.stripe_payment_intent, c.display_name, h.member_no,
         (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
    FROM orders o
    JOIN photo_customers c ON c.id = o.customer_id
    LEFT JOIN households h ON h.id = COALESCE(o.household_id, c.household_id)`;

const toSummary = (r: SummaryRow): AdminOrderSummary => ({
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

export async function listOrders(
  db: D1Database,
  q: { status?: OrderStatus; q?: string; from?: string; to?: string; before?: number },
): Promise<AdminOrdersResponse> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (q.status) {
    where.push('o.status = ?');
    args.push(q.status);
  }
  if (q.q) {
    const n = Number(q.q.replace(/^#/, ''));
    if (Number.isInteger(n) && n > 0) {
      where.push('(o.id = ? OR c.display_name LIKE ? OR h.member_no LIKE ?)');
      args.push(n, `%${q.q}%`, `%${q.q}%`);
    } else {
      where.push('(c.display_name LIKE ? OR h.member_no LIKE ?)');
      args.push(`%${q.q}%`, `%${q.q.toUpperCase()}%`);
    }
  }
  if (q.from) {
    where.push('o.created_at >= ?');
    args.push(`${q.from}T00:00:00+09:00`);
  }
  if (q.to) {
    where.push('o.created_at < ?');
    args.push(`${q.to}T24:00:00+09:00`);
  }
  if (q.before) {
    where.push('o.id < ?');
    args.push(q.before);
  }
  const { results } = await db
    .prepare(`${SUMMARY_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY o.id DESC LIMIT ${PAGE + 1}`)
    .bind(...args)
    .all<SummaryRow>();
  const page = results.slice(0, PAGE);
  return { orders: page.map(toSummary), nextBefore: results.length > PAGE ? page[page.length - 1]!.id : null };
}

async function findOrder(db: D1Database, id: number): Promise<SummaryRow> {
  const row = await db.prepare(`${SUMMARY_SELECT} WHERE o.id = ?`).bind(id).first<SummaryRow>();
  if (!row) throw errors.notFound('注文が見つかりませんでした。注文の一覧から開き直してください。');
  return row;
}

type ItemRow = {
  id: number;
  kind: 'photo' | 'album';
  album_id: number;
  album_name: string;
  photo_id: number | null;
  label: string;
  unit_price: number;
  refunded_at: string | null;
  refund_amount: number | null;
  refund_reason: string | null;
  cover_photo_id: number | null;
};

type ItemState = ItemRow & { photoIds: number[]; downloads: number; check: RefundCheck };

/** 明細ごとに、含まれる写真・ダウンロードの数・返金できるかを調べる */
async function itemStates(db: D1Database, order: SummaryRow, now: Date, refundDays: number): Promise<ItemState[]> {
  const [items, ents, logs] = await db.batch([
    db
      .prepare(
        `SELECT oi.id, oi.kind, oi.album_id, a.name AS album_name, oi.photo_id, oi.label, oi.unit_price, oi.refunded_at, oi.refund_amount, oi.refund_reason, a.cover_photo_id
           FROM order_items oi JOIN albums a ON a.id = oi.album_id WHERE oi.order_id = ? ORDER BY oi.id`,
      )
      .bind(order.id),
    db.prepare('SELECT e.order_item_id, e.photo_id FROM entitlements e JOIN order_items oi ON oi.id = e.order_item_id WHERE oi.order_id = ?').bind(order.id),
    // その購入者の、お支払いのあとのダウンロード(原本・ZIP)
    db
      .prepare('SELECT photo_id, entitlement_id FROM download_logs WHERE customer_id = ? AND created_at >= ?')
      .bind(order.customer_id, order.paid_at ?? '9999'),
  ]);
  const entRows = ents!.results as { order_item_id: number; photo_id: number }[];
  const logRows = logs!.results as { photo_id: number }[];
  return (items!.results as ItemRow[]).map((it) => {
    const photoIds = it.kind === 'photo' && it.photo_id ? [it.photo_id] : entRows.filter((e) => e.order_item_id === it.id).map((e) => e.photo_id);
    const downloads = logRows.filter((l) => photoIds.includes(l.photo_id)).length;
    const check = refundEligibility({ paidAt: order.paid_at, refundedAt: it.refunded_at, downloaded: downloads > 0, now, refundDays });
    return { ...it, photoIds, downloads, check };
  });
}

function blockMessage(check: RefundCheck, refundDays: number): string | null {
  if (check.eligible) return null;
  const m = REFUND_BLOCK_MESSAGES[check.reason];
  return check.reason === 'too_late' ? m.replace('7日', `${refundDays}日`) : m;
}

export async function orderDetail(db: D1Database, id: number, now: Date, refundDays: number): Promise<AdminOrderDetail> {
  const order = await findOrder(db, id);
  const states = await itemStates(db, order, now, refundDays);
  const allPhotoIds = [...new Set(states.flatMap((s) => s.photoIds))];
  const { results: downloads } = await db
    .prepare(
      `SELECT photo_id, kind, created_at, user_agent FROM download_logs
        WHERE customer_id = ? AND photo_id IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC, id DESC LIMIT 500`,
    )
    .bind(order.customer_id, JSON.stringify(allPhotoIds))
    .all<{ photo_id: number; kind: 'original' | 'zip'; created_at: string; user_agent: string | null }>();
  return {
    order: { ...toSummary(order), householdId: order.household_id, stripeSessionId: order.stripe_session_id },
    items: states.map((s) => ({
      id: s.id,
      kind: s.kind,
      albumId: s.album_id,
      albumName: s.album_name,
      photoId: s.photo_id,
      label: s.label,
      unitPrice: s.unit_price,
      thumbUrl: s.photo_id ? adminPhotoThumbUrl(s.photo_id) : s.cover_photo_id ? adminPhotoThumbUrl(s.cover_photo_id) : s.photoIds[0] ? adminPhotoThumbUrl(s.photoIds[0]) : null,
      refundedAt: s.refunded_at,
      refundAmount: s.refund_amount,
      refundReason: s.refund_reason,
      refund: { eligible: s.check.eligible, reason: blockMessage(s.check, refundDays), deadline: s.check.deadline },
      downloads: s.downloads,
    })),
    downloads: downloads.map((d) => ({ photoId: d.photo_id, kind: d.kind, createdAt: d.created_at, userAgent: d.user_agent })),
  };
}

/** 返金する。条件の外の明細は override のときだけ。Stripe の返金は明細ごと(送信の印も明細ごと) */
export async function refundOrder(args: {
  db: D1Database;
  stripe: StripeClient;
  orderId: number;
  input: RefundInput;
  staffId: number;
  now: Date;
  refundDays: number;
}): Promise<RefundResponse> {
  const { db, stripe, input, now } = args;
  const order = await findOrder(db, args.orderId);
  if (order.status !== 'paid' && order.status !== 'partially_refunded') {
    throw new AppError(409, PHOTO_ERROR_CODES.refundNotEligible, 'この注文は返金できません(お支払い済みの注文だけ返金できます)。注文の状態を確かめてください。');
  }
  if (!order.stripe_payment_intent) {
    throw new AppError(409, PHOTO_ERROR_CODES.refundNotEligible, 'お支払いの記録が見つからないため、返金できません。製作者に知らせてください。');
  }
  const states = await itemStates(db, order, now, args.refundDays);
  const byId = new Map(states.map((s) => [s.id, s]));
  const targets = input.itemIds.map((id) => {
    const s = byId.get(id);
    if (!s) throw errors.badRequest('この注文にない明細が選ばれています。画面を読み込み直してください。');
    return s;
  });
  const already = targets.filter((t) => t.refunded_at);
  if (already.length) {
    throw new AppError(409, PHOTO_ERROR_CODES.refundNotEligible, 'もう返金した明細が含まれています。画面を読み込み直してください。', { itemIds: already.map((t) => t.id) });
  }
  const blocked = targets.filter((t) => !t.check.eligible);
  if (blocked.length && !input.override) {
    throw new AppError(
      409,
      PHOTO_ERROR_CODES.refundNotEligible,
      `返金の条件(購入から${args.refundDays}日以内・まだダウンロードしていない)に合わない明細があります。返金するときは、理由を書いて「条件の外で返金する」を選んでください。`,
      { items: blocked.map((t) => ({ id: t.id, reason: blockMessage(t.check, args.refundDays) })) },
    );
  }

  const refunded: number[] = [];
  for (const t of targets) {
    let result;
    try {
      result = await stripe.createRefund({ paymentIntent: order.stripe_payment_intent, amount: t.unit_price, idempotencyKey: `photo-refund-item-${t.id}`, orderId: order.id });
    } catch (e) {
      console.error('返金できませんでした', order.id, t.id, e);
      if (refunded.length) await writeOrderTotals(db, order.id, now);
      throw new AppError(
        502,
        'refund_failed',
        refunded.length
          ? `${refunded.length}件は返金しましたが、残りを返金できませんでした。少し待ってから、残りの明細をもう一度返金してください。`
          : '返金できませんでした。少し待ってから、もう一度お試しください。続くときは製作者に知らせてください。',
      );
    }
    const nowIso = toJstIso(now);
    await db.batch([
      db
        .prepare(
          `UPDATE order_items SET refunded_at = ?, refund_amount = unit_price, stripe_refund_id = ?, refund_reason = ?, refund_override = ?, refunded_by_staff_id = ?
            WHERE id = ? AND refunded_at IS NULL`,
        )
        .bind(nowIso, result.id, input.reason, t.check.eligible ? 0 : 1, args.staffId, t.id),
      db.prepare("UPDATE entitlements SET revoked_at = ?, revoke_reason = 'refund' WHERE order_item_id = ? AND revoked_at IS NULL").bind(nowIso, t.id),
    ]);
    refunded.push(t.id);
  }
  const after = await writeOrderTotals(db, order.id, now);
  const overridden = targets.filter((t) => !t.check.eligible).map((t) => t.id);
  await auditStatement(db, {
    staffId: args.staffId,
    action: 'photo_order.refund',
    targetType: 'photo_order',
    targetId: order.id,
    before: { status: order.status, refundedAmount: order.refunded_amount },
    after: { status: after.status, refundedAmount: after.refunded_amount, itemIds: refunded, override: overridden.length > 0, overriddenItemIds: overridden },
    reason: overridden.length ? `条件の外で返金: ${input.reason}` : input.reason,
    now,
  }).run();
  const auditId = await latestAuditId(db, { action: 'photo_order.refund', targetType: 'photo_order', targetId: order.id, staffId: args.staffId });
  return { order: toSummary(await findOrder(db, order.id)), refundedItemIds: refunded, auditId };
}

/** 注文の返金の合計と状態を、明細から計算し直す */
async function writeOrderTotals(db: D1Database, orderId: number, now: Date) {
  const row = await db
    .prepare(
      `UPDATE orders SET
         refunded_amount = (SELECT COALESCE(SUM(refund_amount), 0) FROM order_items WHERE order_id = ?1),
         status = CASE WHEN (SELECT COUNT(*) FROM order_items WHERE order_id = ?1 AND refunded_at IS NULL) = 0 THEN 'refunded' ELSE 'partially_refunded' END,
         updated_at = ?2
       WHERE id = ?1 RETURNING status, refunded_amount`,
    )
    .bind(orderId, toJstIso(now))
    .first<{ status: OrderStatus; refunded_amount: number }>();
  return row!;
}
