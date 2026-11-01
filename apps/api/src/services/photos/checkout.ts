import {
  PHOTO_CART_MAX,
  PHOTO_ERROR_CODES,
  cartLineStates,
  cartTotal,
  dedupeCartItems,
  isOnSale,
  photoCancelUrl,
  photoSuccessUrl,
  photoThumbUrl,
  resolveAlbumPrice,
  resolvePhotoPrice,
  toJstIso,
  type CartAddResponse,
  type CartEntry,
  type CartItem,
  type CartItemView,
  type CartLineState,
  type CartLineView,
  type CartResponse,
  type CartUnavailableReason,
  type CheckoutResponse,
  type MyOrder,
  type OrderStatus,
} from '@dr/shared';
import { AppError, errors } from '../../lib/errors';
import type { PhotoCustomer } from '../../lib/photos/customers';
import type { StripeClient } from '../../lib/photos/stripe';

// 段階1-C 決済: サーバー側のカートと購入手続き(docs/photo-requirements.md 3.9・8.1)。
// - カートは cart_items(購入者ごと)。金額は持たず、見るたびに DB の価格で計算する(画面から送られた金額は使わない)
// - 行ごとの状態は shared の cartLineStates(ok / redundant = まるごとに含まれる / unavailable = 買えない)
// - 購入手続きは、もう一度すべて確かめ、ok の行だけで注文(pending)と1つの Checkout Session(明細は複数)を作る

/** カートの行の印の横に出す一言(お客さん向け) */
export const CART_REASON_MESSAGES: Record<CartUnavailableReason | 'in_album', string> = {
  ended: '販売が終わりました',
  hidden: 'いまは販売していません',
  not_found: 'アルバムから外されました',
  already_owned: '購入済みです',
  no_album_price: 'まるごとでは買えなくなりました',
  in_album: 'アルバムまるごとに含まれています',
};

/** カートに入れなかったときの一言 */
export const CART_SKIP_MESSAGES: Record<CartAddResponse['skipped'][number]['reason'], string> = {
  already_in_cart: 'すでにカートにあります',
  ended: CART_REASON_MESSAGES.ended,
  hidden: CART_REASON_MESSAGES.hidden,
  not_found: '見つかりませんでした',
  already_owned: CART_REASON_MESSAGES.already_owned,
  no_album_price: 'このアルバムは、まるごとでは買えません',
};

/** Checkout の期限(分)。Stripe は30分〜24時間 */
export const CHECKOUT_EXPIRES_MINUTES = 60;

type Ref = { kind: 'photo' | 'album'; albumId: number; photoId: number | null };

type AlbumRow = {
  id: number;
  name: string;
  status: string;
  removed_at: string | null;
  sale_ends_at: string | null;
  cover_photo_id: number | null;
  unit_price: number;
  album_price: number | null;
};
type AlbumPhotoRow = {
  album_id: number;
  photo_id: number;
  status: string;
  price_override: number | null;
  published_at: string | null;
  sort_order: number;
  original_filename: string;
  files_deleted_at: string | null;
};

/** 1行を調べた結果 */
export type Evaluated = {
  unavailable: CartUnavailableReason | null;
  unitPrice: number;
  albumName: string;
  /** カートに出す名前(「IMG_0012」「アルバムまるごと(12枚)」) */
  label: string;
  /** 注文の明細の名前(注文した時点で固定。「2026/11/03 IMG_0012」) */
  orderLabel: string;
  thumbUrl: string | null;
  photoCount: number | null;
  /** まるごとのとき: いま公開中の写真(まるごと購入で権利が付く写真) */
  albumPhotoIds: number[];
};

const fileBase = (name: string) => (name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name);
const json = (xs: number[]) => JSON.stringify([...new Set(xs)]);

/** 調べるのに要るものを、まとめて読む(行が200あっても問い合わせは3回) */
async function loadContext(db: D1Database, customerId: number, refs: Ref[]) {
  const albumIds = refs.map((r) => r.albumId);
  const photoIds = refs.flatMap((r) => (r.photoId === null ? [] : [r.photoId]));
  const [albums, aps, owned] = await db.batch([
    db
      .prepare(
        `SELECT a.id, a.name, a.status, a.removed_at, a.sale_ends_at, a.cover_photo_id, pl.unit_price, pl.album_price
           FROM albums a JOIN price_lists pl ON pl.id = a.price_list_id
          WHERE a.id IN (SELECT value FROM json_each(?1))`,
      )
      .bind(json(albumIds)),
    db
      .prepare(
        `SELECT ap.album_id, ap.photo_id, ap.status, ap.price_override, ap.published_at, ap.sort_order, p.original_filename, p.files_deleted_at
           FROM album_photos ap JOIN photos p ON p.id = ap.photo_id
          WHERE ap.album_id IN (SELECT value FROM json_each(?1))
            AND (ap.status = 'published' OR ap.photo_id IN (SELECT value FROM json_each(?2)))
          ORDER BY ap.album_id, ap.sort_order, ap.id`,
      )
      .bind(json(albumIds), json(photoIds)),
    db.prepare('SELECT photo_id FROM entitlements WHERE customer_id = ? AND revoked_at IS NULL').bind(customerId),
  ]);
  const albumMap = new Map((albums!.results as AlbumRow[]).map((a) => [a.id, a]));
  const pairMap = new Map<string, AlbumPhotoRow>();
  const published = new Map<number, AlbumPhotoRow[]>();
  for (const ap of aps!.results as AlbumPhotoRow[]) {
    pairMap.set(`${ap.album_id}:${ap.photo_id}`, ap);
    if (ap.status === 'published' && !ap.files_deleted_at) {
      const list = published.get(ap.album_id) ?? [];
      list.push(ap);
      published.set(ap.album_id, list);
    }
  }
  const ownedSet = new Set((owned!.results as { photo_id: number }[]).map((r) => r.photo_id));
  return { albumMap, pairMap, published, owned: ownedSet };
}

type Context = Awaited<ReturnType<typeof loadContext>>;

/** 1行がいま買えるか・いくらか(サーバーが DB から決める) */
function evaluate(ref: Ref, ctx: Context, now: Date): Evaluated {
  const album = ctx.albumMap.get(ref.albumId);
  const base: Evaluated = {
    unavailable: null,
    unitPrice: 0,
    albumName: album?.name ?? 'アルバム',
    label: ref.kind === 'album' ? 'アルバムまるごと' : '写真',
    orderLabel: '',
    thumbUrl: null,
    photoCount: null,
    albumPhotoIds: [],
  };
  const fail = (reason: CartUnavailableReason): Evaluated => ({ ...base, unavailable: reason });
  if (!album || album.removed_at) return fail('not_found');
  if (album.status === 'draft') return fail('hidden');
  if (!isOnSale({ status: album.status, saleEndsAt: album.sale_ends_at }, now)) return fail('ended');

  if (ref.kind === 'photo') {
    const ap = ref.photoId === null ? undefined : ctx.pairMap.get(`${ref.albumId}:${ref.photoId}`);
    if (!ap || ap.status === 'removed') return fail('not_found');
    const name = fileBase(ap.original_filename);
    const filled: Evaluated = {
      ...base,
      label: name,
      orderLabel: `${album.name} ${name}`,
      unitPrice: resolvePhotoPrice({ priceOverride: ap.price_override, unitPrice: album.unit_price }),
      thumbUrl: ap.status === 'published' ? photoThumbUrl(ref.albumId, ap.photo_id) : null,
    };
    if (ap.status !== 'published') return { ...filled, unavailable: 'hidden' };
    if (ap.files_deleted_at) return { ...filled, unavailable: 'ended' };
    if (ctx.owned.has(ap.photo_id)) return { ...filled, unavailable: 'already_owned' };
    return filled;
  }

  const photos = ctx.published.get(ref.albumId) ?? [];
  const cover = photos.find((p) => p.photo_id === album.cover_photo_id) ?? photos[0];
  const price = resolveAlbumPrice({ albumPrice: album.album_price });
  const filled: Evaluated = {
    ...base,
    label: `アルバムまるごと(${photos.length}枚)`,
    orderLabel: `${album.name} まるごと(${photos.length}枚)`,
    unitPrice: price ?? 0,
    thumbUrl: cover ? photoThumbUrl(ref.albumId, cover.photo_id) : null,
    photoCount: photos.length,
    albumPhotoIds: photos.map((p) => p.photo_id),
  };
  if (price === null) return { ...filled, unavailable: 'no_album_price' };
  if (photos.length === 0) return { ...filled, unavailable: 'hidden' };
  if (photos.every((p) => ctx.owned.has(p.photo_id))) return { ...filled, unavailable: 'already_owned' };
  return filled;
}

type CartRow = { id: number; kind: 'photo' | 'album'; album_id: number; photo_id: number | null; added_at: string };

export type EvaluatedCartLine = CartItemView & { evaluated: Evaluated };

/** カートを読み、行ごとに調べる。合計は ok の行だけ */
export async function evaluateCart(db: D1Database, customerId: number, now: Date): Promise<{ cart: CartResponse; lines: EvaluatedCartLine[] }> {
  const { results: rows } = await db
    .prepare(
      `SELECT id, kind, album_id, photo_id, added_at FROM cart_items
        WHERE customer_id = ? AND removed_at IS NULL AND ordered_at IS NULL ORDER BY id`,
    )
    .bind(customerId)
    .all<CartRow>();
  if (rows.length === 0) return { cart: { items: [], total: 0, payableCount: 0 }, lines: [] };
  const ctx = await loadContext(
    db,
    customerId,
    rows.map((r) => ({ kind: r.kind, albumId: r.album_id, photoId: r.photo_id })),
  );
  const evaluated = new Map(rows.map((r) => [r.id, evaluate({ kind: r.kind, albumId: r.album_id, photoId: r.photo_id }, ctx, now)]));
  const entries: CartEntry[] = rows.map((r) => ({ id: r.id, kind: r.kind, albumId: r.album_id, photoId: r.photo_id, unavailable: evaluated.get(r.id)!.unavailable }));
  const albumPhotoIds = new Map<number, ReadonlySet<number>>();
  for (const r of rows) if (r.kind === 'album') albumPhotoIds.set(r.album_id, new Set(evaluated.get(r.id)!.albumPhotoIds));
  const states = cartLineStates(entries, albumPhotoIds);
  const lines: EvaluatedCartLine[] = rows.map((r) => {
    const ev = evaluated.get(r.id)!;
    const state = states.get(r.id) as CartLineState;
    const reason = state === 'redundant' ? 'in_album' : state === 'unavailable' ? ev.unavailable : null;
    return {
      id: r.id,
      kind: r.kind,
      albumId: r.album_id,
      photoId: r.photo_id,
      albumName: ev.albumName,
      label: ev.label,
      unitPrice: ev.unitPrice,
      thumbUrl: ev.thumbUrl,
      photoCount: ev.photoCount,
      state,
      reason,
      message: reason ? CART_REASON_MESSAGES[reason] : null,
      addedAt: r.added_at,
      evaluated: ev,
    };
  });
  const ok = lines.filter((l) => l.state === 'ok');
  return {
    cart: {
      items: lines.map(({ evaluated: _e, ...view }) => view),
      total: cartTotal(ok.map((l) => ({ kind: l.kind, albumId: l.albumId, photoId: l.photoId ?? undefined, unitPrice: l.unitPrice }))),
      payableCount: ok.length,
    },
    lines,
  };
}

/** 複数をまとめてカートに入れる。重なり・買えないものは入れずに skipped で返す */
export async function addToCart(db: D1Database, customerId: number, items: CartItem[], now: Date): Promise<CartAddResponse> {
  const unique = dedupeCartItems(items);
  const refs: Ref[] = unique.map((i) => ({ kind: i.kind, albumId: i.albumId, photoId: i.kind === 'photo' ? i.photoId : null }));
  const ctx = await loadContext(db, customerId, refs);
  const skipped: CartAddResponse['skipped'] = [];
  const toInsert: { item: CartItem; ref: Ref }[] = [];
  unique.forEach((item, i) => {
    const ev = evaluate(refs[i]!, ctx, now);
    if (ev.unavailable) skipped.push({ item, reason: ev.unavailable, message: CART_SKIP_MESSAGES[ev.unavailable] });
    else toInsert.push({ item, ref: refs[i]! });
  });
  // 上限(1人のカートに200行まで)
  const count = await db
    .prepare('SELECT COUNT(*) AS n FROM cart_items WHERE customer_id = ? AND removed_at IS NULL AND ordered_at IS NULL')
    .bind(customerId)
    .first<{ n: number }>();
  if ((count?.n ?? 0) + toInsert.length > PHOTO_CART_MAX) {
    throw errors.badRequest(`カートに入れられるのは${PHOTO_CART_MAX}件までです。購入手続きをするか、いくつか外してから入れてください。`);
  }
  let added = 0;
  if (toInsert.length > 0) {
    const nowIso = toJstIso(now);
    // 同じ写真・同じまるごとは、一意の索引で1つだけ(ぶつかったら入れない = すでにカートにある)
    const results = await db.batch(
      toInsert.map(({ ref }) =>
        db
          .prepare(
            `INSERT INTO cart_items (customer_id, kind, album_id, photo_id, added_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT DO NOTHING RETURNING id`,
          )
          .bind(customerId, ref.kind, ref.albumId, ref.photoId, nowIso),
      ),
    );
    results.forEach((r, i) => {
      if (r.results.length > 0) added++;
      else skipped.push({ item: toInsert[i]!.item, reason: 'already_in_cart', message: CART_SKIP_MESSAGES.already_in_cart });
    });
  }
  const { cart } = await evaluateCart(db, customerId, now);
  return { ...cart, added, skipped };
}

/** 1行外す(行は消さず removed_at)。自分の行でなければ 404 */
export async function removeCartItem(db: D1Database, customerId: number, itemId: number, now: Date): Promise<void> {
  const r = await db
    .prepare('UPDATE cart_items SET removed_at = ? WHERE id = ? AND customer_id = ? AND removed_at IS NULL AND ordered_at IS NULL')
    .bind(toJstIso(now), itemId, customerId)
    .run();
  if (!r.meta.changes) throw errors.notFound('カートの中に見つかりませんでした。画面を読み込み直してください。');
}

/** 購入手続き: ok の行で注文(pending)と1つの Checkout Session(明細は複数)を作る */
export async function createCheckout(args: {
  db: D1Database;
  stripe: StripeClient;
  customer: PhotoCustomer;
  now: Date;
  origin: string;
  /** 送信の印(画面の Idempotency-Key)。同じ印では注文を二重に作らない */
  requestKey: string | null;
}): Promise<CheckoutResponse> {
  const { db, stripe, customer, now, origin } = args;
  const requestKey = args.requestKey ? `${customer.id}:${args.requestKey}` : null;
  if (requestKey) {
    const prev = await db
      .prepare('SELECT id, amount, status, stripe_session_id FROM orders WHERE request_key = ? AND customer_id = ?')
      .bind(requestKey, customer.id)
      .first<{ id: number; amount: number; status: string; stripe_session_id: string | null }>();
    if (prev) {
      // 同じ送信の2回目: 前に作った注文をそのまま返す(Stripe も同じ印で同じ Session を返す)
      if (prev.status !== 'pending') throw errors.conflict('order_not_pending', 'この注文は、もうお支払いが済んでいるか、期限が切れています。カートを開き直してください。');
      return startSession({ db, stripe, now, origin, orderId: prev.id, amount: prev.amount, excludedItemIds: [] });
    }
  }

  // 購入手続きの直前にも、もう一度すべて確かめる
  const { lines } = await evaluateCart(db, customer.id, now);
  const ok = lines.filter((l) => l.state === 'ok');
  const excludedItemIds = lines.filter((l) => l.state !== 'ok').map((l) => l.id);
  if (ok.length === 0) {
    throw new AppError(
      409,
      PHOTO_ERROR_CODES.cartEmpty,
      lines.length === 0
        ? 'カートが空です。アルバムで写真を選んで「カートに入れる」を押してください。'
        : 'カートに、いま買える写真がありません。販売が終わった写真や購入済みの写真は買えません。',
    );
  }
  const amount = cartTotal(ok.map((l) => ({ kind: l.kind, albumId: l.albumId, unitPrice: l.unitPrice })));
  const nowIso = toJstIso(now);
  const order = await db
    .prepare(
      `INSERT INTO orders (customer_id, household_id, status, amount, currency, payment_mode, request_key, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, 'jpy', ?, ?, ?, ?) RETURNING id`,
    )
    .bind(customer.id, customer.householdId, amount, stripe.mode, requestKey, nowIso, nowIso)
    .first<{ id: number }>();
  if (!order) throw new Error('注文を作れませんでした');
  await db.batch(
    ok.map((l) =>
      db
        .prepare('INSERT INTO order_items (order_id, kind, album_id, photo_id, unit_price, label) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(order.id, l.kind, l.albumId, l.kind === 'photo' ? l.photoId : null, l.unitPrice, l.evaluated.orderLabel),
    ),
  );
  return startSession({ db, stripe, now, origin, orderId: order.id, amount, excludedItemIds });
}

async function startSession(args: {
  db: D1Database;
  stripe: StripeClient;
  now: Date;
  origin: string;
  orderId: number;
  amount: number;
  excludedItemIds: number[];
}): Promise<CheckoutResponse> {
  const { db, stripe, now, origin, orderId } = args;
  const { results: items } = await db
    .prepare('SELECT label, unit_price FROM order_items WHERE order_id = ? ORDER BY id')
    .bind(orderId)
    .all<{ label: string; unit_price: number }>();
  const expiresAt = Math.floor(now.getTime() / 1000) + CHECKOUT_EXPIRES_MINUTES * 60;
  let session;
  try {
    session = await stripe.createCheckoutSession({
      orderId,
      lines: items.map((i) => ({ name: i.label, amount: i.unit_price })),
      successUrl: photoSuccessUrl(origin, orderId),
      cancelUrl: photoCancelUrl(origin),
      idempotencyKey: `photo-order-${orderId}`,
      expiresAt,
      origin,
    });
  } catch (e) {
    console.error('Checkout を作れませんでした', e);
    await db
      .prepare("UPDATE orders SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending' AND stripe_session_id IS NULL")
      .bind(toJstIso(now), orderId)
      .run();
    throw new AppError(502, 'checkout_failed', 'お支払いの画面を開けませんでした。少し待ってから、もう一度「購入手続きへ」を押してください。');
  }
  await db
    .prepare('UPDATE orders SET stripe_session_id = ?, expires_at = ?, updated_at = ? WHERE id = ?')
    .bind(session.id, toJstIso(new Date((session.expiresAt ?? expiresAt) * 1000)), toJstIso(now), orderId)
    .run();
  return { orderId, checkoutUrl: session.url, amount: args.amount, excludedItemIds: args.excludedItemIds };
}

// ---------------------------------------------------------------- 自分の注文(PU-6)

type OrderRow = { id: number; status: OrderStatus; amount: number; created_at: string; paid_at: string | null };
type ItemRow = { order_id: number; kind: 'photo' | 'album'; album_id: number; photo_id: number | null; unit_price: number; label: string; album_name: string; photo_count: number };

/** 自分の注文(新しい順)。id を渡すと1件だけ。ほかの人の注文は返さない */
export async function myOrders(db: D1Database, customerId: number, id?: number): Promise<MyOrder[]> {
  const { results: orders } = await db
    .prepare(
      `SELECT id, status, amount, created_at, paid_at FROM orders
        WHERE customer_id = ?1 AND (?2 IS NULL OR id = ?2) ORDER BY id DESC LIMIT 100`,
    )
    .bind(customerId, id ?? null)
    .all<OrderRow>();
  if (orders.length === 0) return [];
  const { results: items } = await db
    .prepare(
      `SELECT oi.order_id, oi.kind, oi.album_id, oi.photo_id, oi.unit_price, oi.label, a.name AS album_name,
              (SELECT COUNT(*) FROM entitlements e WHERE e.order_item_id = oi.id) AS photo_count
         FROM order_items oi JOIN albums a ON a.id = oi.album_id
        WHERE oi.order_id IN (SELECT value FROM json_each(?)) ORDER BY oi.id`,
    )
    .bind(JSON.stringify(orders.map((o) => o.id)))
    .all<ItemRow>();
  return orders.map((o) => ({
    id: o.id,
    status: o.status,
    amount: o.amount,
    createdAt: o.created_at,
    paidAt: o.paid_at,
    lines: items
      .filter((i) => i.order_id === o.id)
      .map(
        (i): CartLineView => ({
          kind: i.kind,
          albumId: i.album_id,
          photoId: i.photo_id,
          albumName: i.album_name,
          label: (i.label.startsWith(i.album_name) ? i.label.slice(i.album_name.length).trim() : '') || i.label,
          unitPrice: i.unit_price,
          // 注文の写真は、購入の権利があれば「購入した写真」で見られる。ここでは小さな写真を出さない(販売終了のあとも開けるように)
          thumbUrl: null,
          photoCount: i.kind === 'album' ? (o.paid_at ? i.photo_count : null) : null,
        }),
      ),
  }));
}
