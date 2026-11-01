import { albumEntitlementPhotoIds, toJstIso, type AlbumPhotoStatus } from '@dr/shared';
import type { Bindings } from '../../env';
import { newPhotoKey, type PhotoStorage } from '../../lib/photos/storage';
import { auditStatement } from '../audit';
import type { PushTransport } from '../line-push';
import { notifyPurchase } from './notify';

// Stripe の Webhook の処理(docs/photo-requirements.md 8.2。段階1-C)。署名は routes/photos/webhook.ts で確かめ済み。
// - webhook_events に stripe_event_id を入れてから処理する(同じイベントは1回だけ)。失敗したら failed にして 500(Stripe が送り直す)
// - checkout.session.completed: 金額を確かめ → paid → 権利(まるごとは albumEntitlementPhotoIds)→ カートの行に ordered_at
//   → 原本を購入済み領域へコピーして SHA-256 を確かめる → 購入完了の LINE のお知らせ。
//   コピーとお知らせは、送り直しのときに続きからやり直せる(どちらも、済んでいるものは何もしない)
// - checkout.session.expired: 注文を expired に(カートはそのまま)
// - charge.refunded: 返金した明細の権利を無効に(管理画面の返金で記録済みなら何もしない)

export type StripeEventLike = { id: string; type: string; data: { object: Record<string, unknown> } };
export type WebhookDeps = {
  env: Pick<Bindings, 'DB' | 'ENVIRONMENT' | 'LINE_MESSAGING_TOKEN'>;
  storage: PhotoStorage | null;
  now: Date;
  transport?: PushTransport;
};
export type WebhookOutcome = { status: 'processed' | 'ignored' | 'duplicate' | 'in_progress'; note: string | null };

/** 処理中のまま止まったイベント(Worker が途中で止まった)を、やり直してよいとみなすまでの秒 */
const STALE_PROCESSING_SECONDS = 120;

/** イベントを1回だけ処理する */
export async function processStripeEvent(deps: WebhookDeps, event: StripeEventLike): Promise<WebhookOutcome> {
  const db = deps.env.DB;
  const nowIso = toJstIso(deps.now);
  const claimed = await db
    .prepare(
      `INSERT INTO webhook_events (stripe_event_id, type, status, received_at) VALUES (?, ?, 'processing', ?)
       ON CONFLICT DO NOTHING RETURNING stripe_event_id`,
    )
    .bind(event.id, event.type, nowIso)
    .first();
  if (!claimed) {
    const prev = await db.prepare('SELECT status, received_at FROM webhook_events WHERE stripe_event_id = ?').bind(event.id).first<{ status: string; received_at: string }>();
    if (!prev || prev.status === 'processed' || prev.status === 'ignored') return { status: 'duplicate', note: null };
    // 前に失敗したもの・処理中のまま止まったものは、やり直す(条件つきで取り直す。同時に2つは動かない)
    const staleBefore = toJstIso(new Date(deps.now.getTime() - STALE_PROCESSING_SECONDS * 1000));
    const retake = await db
      .prepare(
        `UPDATE webhook_events SET status = 'processing', error = NULL, received_at = ?1
          WHERE stripe_event_id = ?2 AND (status = 'failed' OR (status = 'processing' AND received_at < ?3))`,
      )
      .bind(nowIso, event.id, staleBefore)
      .run();
    if (!retake.meta.changes) return { status: 'in_progress', note: null };
  }

  try {
    const outcome = await dispatch(deps, event);
    await db
      .prepare('UPDATE webhook_events SET status = ?, error = ?, processed_at = ? WHERE stripe_event_id = ?')
      .bind(outcome.status === 'ignored' ? 'ignored' : 'processed', outcome.note, toJstIso(deps.now), event.id)
      .run();
    return outcome;
  } catch (e) {
    const message = String((e as Error)?.message ?? e).slice(0, 500);
    await db
      .prepare("UPDATE webhook_events SET status = 'failed', error = ?, processed_at = ? WHERE stripe_event_id = ?")
      .bind(message, toJstIso(deps.now), event.id)
      .run()
      .catch(() => {});
    throw e;
  }
}

function dispatch(deps: WebhookDeps, event: StripeEventLike): Promise<WebhookOutcome> {
  const o = event.data?.object ?? {};
  switch (event.type) {
    case 'checkout.session.completed':
      return onCompleted(deps, o);
    case 'checkout.session.expired':
      return onExpired(deps, o);
    case 'charge.refunded':
      return onRefunded(deps, o);
    default:
      return Promise.resolve({ status: 'ignored', note: 'unhandled_type' });
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

type OrderRow = { id: number; customer_id: number; status: string; amount: number; currency: string; paid_at: string | null; refunded_amount: number; stripe_payment_intent: string | null };

// ---------------------------------------------------------------- checkout.session.completed

async function onCompleted(deps: WebhookDeps, session: Record<string, unknown>): Promise<WebhookOutcome> {
  const db = deps.env.DB;
  const sessionId = str(session.id);
  if (!sessionId) return { status: 'ignored', note: 'no_session' };
  const order = await db
    .prepare('SELECT id, customer_id, status, amount, currency, paid_at, refunded_amount, stripe_payment_intent FROM orders WHERE stripe_session_id = ?')
    .bind(sessionId)
    .first<OrderRow>();
  if (!order) return { status: 'ignored', note: 'order_not_found' };
  const metaOrderId = str((session.metadata as Record<string, unknown> | undefined)?.order_id) ?? str(session.client_reference_id);
  if (metaOrderId !== String(order.id)) return { status: 'ignored', note: 'order_mismatch' };

  if (order.status === 'pending') {
    if (session.payment_status !== 'paid') return { status: 'ignored', note: 'not_paid' };
    const amountTotal = typeof session.amount_total === 'number' ? session.amount_total : null;
    const currency = str(session.currency)?.toLowerCase() ?? null;
    if (amountTotal !== order.amount || currency !== order.currency) {
      // 金額が注文と違う: 確定しない。製作者・管理者が気づけるよう、操作ログに残す
      await auditStatement(db, {
        staffId: null,
        actor: { type: 'system', id: null },
        action: 'photo_order.amount_mismatch',
        targetType: 'photo_order',
        targetId: order.id,
        before: { amount: order.amount, currency: order.currency },
        after: { amount: amountTotal, currency, sessionId },
        reason: 'Stripe から届いたお支払いの金額が、注文の金額と違いました。注文は確定していません。',
        now: deps.now,
      }).run();
      return { status: 'ignored', note: 'amount_mismatch' };
    }
    await confirmOrder(deps, order, str(session.payment_intent));
  } else if (order.status === 'expired' || order.status === 'canceled') {
    return { status: 'ignored', note: `order_${order.status}` };
  }
  // ここから先は、送り直しでも続きから(済んでいるものは何もしない)
  const mismatched = await ensurePurchasedCopies(deps, order.id);
  await notifyPurchase(deps.env, order.id, deps.now, deps.transport);
  return { status: 'processed', note: mismatched.length ? `hash_mismatch:${mismatched.join(',')}` : null };
}

/** 注文を paid にし、権利を作り、カートの行を注文に入れる(1つのまとまりで書く) */
async function confirmOrder(deps: WebhookDeps, order: OrderRow, paymentIntent: string | null): Promise<void> {
  const db = deps.env.DB;
  const paidAt = toJstIso(deps.now);
  const { results: items } = await db
    .prepare('SELECT id, kind, album_id, photo_id FROM order_items WHERE order_id = ? ORDER BY id')
    .bind(order.id)
    .all<{ id: number; kind: 'photo' | 'album'; album_id: number; photo_id: number | null }>();
  const { results: ownedRows } = await db
    .prepare('SELECT photo_id FROM entitlements WHERE customer_id = ? AND revoked_at IS NULL')
    .bind(order.customer_id)
    .all<{ photo_id: number }>();
  const owned = new Set(ownedRows.map((r) => r.photo_id));
  const grants: { itemId: number; photoId: number }[] = [];
  // 1枚ずつの明細を先に(まるごとと重なっても、1枚の明細に権利を付ける)
  for (const it of items) {
    if (it.kind !== 'photo' || it.photo_id === null || owned.has(it.photo_id)) continue;
    owned.add(it.photo_id);
    grants.push({ itemId: it.id, photoId: it.photo_id });
  }
  for (const it of items) {
    if (it.kind !== 'album') continue;
    const { results: photos } = await db
      .prepare(
        `SELECT ap.photo_id, ap.status, ap.published_at, p.files_deleted_at
           FROM album_photos ap JOIN photos p ON p.id = ap.photo_id WHERE ap.album_id = ? ORDER BY ap.sort_order, ap.id`,
      )
      .bind(it.album_id)
      .all<{ photo_id: number; status: AlbumPhotoStatus; published_at: string | null; files_deleted_at: string | null }>();
    // お支払いが確定した時点で公開中の写真だけ(3.4)。すでに持っている写真には作らない
    const ids = albumEntitlementPhotoIds(
      photos.map((p) => ({ photoId: p.photo_id, status: p.status, publishedAt: p.published_at, filesDeleted: !!p.files_deleted_at })),
      paidAt,
      owned,
    );
    for (const id of ids) {
      owned.add(id);
      grants.push({ itemId: it.id, photoId: id });
    }
  }
  const photoIds = [...new Set([...items.flatMap((i) => (i.photo_id ? [i.photo_id] : [])), ...grants.map((g) => g.photoId)])];
  const albumIds = items.filter((i) => i.kind === 'album').map((i) => i.album_id);
  const stmts: D1PreparedStatement[] = [
    db
      .prepare("UPDATE orders SET status = 'paid', paid_at = ?, stripe_payment_intent = COALESCE(?, stripe_payment_intent), updated_at = ? WHERE id = ? AND status = 'pending'")
      .bind(paidAt, paymentIntent, paidAt, order.id),
    ...grants.map((g) =>
      db
        .prepare('INSERT INTO entitlements (customer_id, photo_id, order_item_id, granted_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
        .bind(order.customer_id, g.photoId, g.itemId, paidAt),
    ),
    // 注文に入れたカートの行(と、まるごとに含まれていた1枚の行)をカートから出す
    db
      .prepare(
        `UPDATE cart_items SET ordered_at = ?1, order_id = ?2
          WHERE customer_id = ?3 AND removed_at IS NULL AND ordered_at IS NULL
            AND ((kind = 'photo' AND photo_id IN (SELECT value FROM json_each(?4)))
              OR (kind = 'album' AND album_id IN (SELECT value FROM json_each(?5))))`,
      )
      .bind(paidAt, order.id, order.customer_id, JSON.stringify(photoIds), JSON.stringify(albumIds)),
  ];
  await db.batch(stmts);
}

/**
 * 購入した写真の原本を、購入済み領域へコピーする(まだコピーしていない写真だけ)。
 * コピーの後にサーバーで SHA-256 を計算し、アップロードのときの値と比べる。合わなければ photos.hash_mismatch_at を入れ、
 * 操作ログに残す(管理者・製作者に知らせる)。合わなかった写真の番号を返す
 */
export async function ensurePurchasedCopies(deps: Pick<WebhookDeps, 'env' | 'storage' | 'now'>, orderId: number): Promise<number[]> {
  const db = deps.env.DB;
  const { results: photos } = await db
    .prepare(
      `SELECT DISTINCT p.id, p.original_key, p.sha256, p.content_type
         FROM entitlements e JOIN order_items oi ON oi.id = e.order_item_id JOIN photos p ON p.id = e.photo_id
        WHERE oi.order_id = ? AND e.revoked_at IS NULL AND p.purchased_key IS NULL`,
    )
    .bind(orderId)
    .all<{ id: number; original_key: string; sha256: string; content_type: string }>();
  if (photos.length === 0) return [];
  if (!deps.storage) throw new Error('写真の置き場所の設定がないため、購入した写真をコピーできませんでした');
  const mismatched: number[] = [];
  for (const p of photos) {
    const key = newPhotoKey('purchased', p.content_type);
    await deps.storage.copy(p.original_key, key, deps.now);
    const actual = await deps.storage.sha256(key);
    const nowIso = toJstIso(deps.now);
    if (actual && actual.toLowerCase() === p.sha256.toLowerCase()) {
      await db
        .prepare('UPDATE photos SET purchased_key = ?, purchased_verified_at = ? WHERE id = ? AND purchased_key IS NULL')
        .bind(key, nowIso, p.id)
        .run();
    } else {
      mismatched.push(p.id);
      await db.batch([
        db.prepare('UPDATE photos SET hash_mismatch_at = ? WHERE id = ?').bind(nowIso, p.id),
        auditStatement(db, {
          staffId: null,
          actor: { type: 'system', id: null },
          action: 'photo.hash_mismatch',
          targetType: 'photo',
          targetId: p.id,
          before: { sha256: p.sha256 },
          after: { sha256: actual, area: 'purchased', orderId },
          reason: '購入済みの場所へコピーした写真が、アップロードした原本と一致しませんでした。製作者に知らせてください。',
          now: deps.now,
        }),
      ]);
    }
  }
  return mismatched;
}

// ---------------------------------------------------------------- checkout.session.expired

async function onExpired(deps: WebhookDeps, session: Record<string, unknown>): Promise<WebhookOutcome> {
  const sessionId = str(session.id);
  if (!sessionId) return { status: 'ignored', note: 'no_session' };
  const r = await deps.env.DB.prepare("UPDATE orders SET status = 'expired', updated_at = ? WHERE stripe_session_id = ? AND status = 'pending'")
    .bind(toJstIso(deps.now), sessionId)
    .run();
  return r.meta.changes ? { status: 'processed', note: null } : { status: 'ignored', note: 'not_pending' };
}

// ---------------------------------------------------------------- charge.refunded

/** Stripe の管理画面などで返金されたときの理由(明細に残す) */
export const STRIPE_SIDE_REFUND_REASON = 'Stripe の管理画面で返金されました';

async function onRefunded(deps: WebhookDeps, charge: Record<string, unknown>): Promise<WebhookOutcome> {
  const db = deps.env.DB;
  const pi = str(charge.payment_intent);
  if (!pi) return { status: 'ignored', note: 'no_payment_intent' };
  const order = await db
    .prepare('SELECT id, customer_id, status, amount, currency, paid_at, refunded_amount, stripe_payment_intent FROM orders WHERE stripe_payment_intent = ?')
    .bind(pi)
    .first<OrderRow>();
  if (!order) return { status: 'ignored', note: 'order_not_found' };
  const refunded = typeof charge.amount_refunded === 'number' ? charge.amount_refunded : 0;
  // 管理画面の返金で、もう記録してある(二重にしない)
  if (refunded <= order.refunded_amount) return { status: 'processed', note: 'already_recorded' };
  const full = charge.refunded === true || refunded >= order.amount;
  if (!full) {
    // 一部だけの返金は、どの明細かが分からない。権利はそのままにして、管理者に知らせる
    await auditStatement(db, {
      staffId: null,
      actor: { type: 'system', id: null },
      action: 'photo_order.refund_unmatched',
      targetType: 'photo_order',
      targetId: order.id,
      before: { refundedAmount: order.refunded_amount },
      after: { refundedAmount: refunded },
      reason: 'Stripe で一部の金額が返金されましたが、どの写真の分かが分かりません。注文の画面で確かめてください。',
      now: deps.now,
    }).run();
    return { status: 'processed', note: 'partial_unmatched' };
  }
  const nowIso = toJstIso(deps.now);
  const refundsList = (charge.refunds as { data?: { id?: string }[] } | undefined)?.data;
  const refundId = refundsList?.[0]?.id ?? null;
  await db.batch([
    db
      .prepare(
        `UPDATE entitlements SET revoked_at = ?1, revoke_reason = 'refund'
          WHERE revoked_at IS NULL AND order_item_id IN (SELECT id FROM order_items WHERE order_id = ?2 AND refunded_at IS NULL)`,
      )
      .bind(nowIso, order.id),
    db
      .prepare(
        `UPDATE order_items SET refunded_at = ?1, refund_amount = unit_price, stripe_refund_id = ?2, refund_reason = ?3
          WHERE order_id = ?4 AND refunded_at IS NULL`,
      )
      .bind(nowIso, refundId, STRIPE_SIDE_REFUND_REASON, order.id),
    db
      .prepare(
        `UPDATE orders SET status = 'refunded', refunded_amount = (SELECT COALESCE(SUM(refund_amount), 0) FROM order_items WHERE order_id = ?1), updated_at = ?2
          WHERE id = ?1`,
      )
      .bind(order.id, nowIso),
    auditStatement(db, {
      staffId: null,
      actor: { type: 'system', id: null },
      action: 'photo_order.refund',
      targetType: 'photo_order',
      targetId: order.id,
      before: { status: order.status, refundedAmount: order.refunded_amount },
      after: { status: 'refunded', refundedAmount: refunded },
      reason: STRIPE_SIDE_REFUND_REASON,
      now: deps.now,
    }),
  ]);
  return { status: 'processed', note: null };
}
