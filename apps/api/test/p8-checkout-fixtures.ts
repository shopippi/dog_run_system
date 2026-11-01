import { env } from 'cloudflare:test';
import { sha256Hex } from '@dr/shared';
import { photoStorage } from '../src/lib/photos/storage';
import { call } from './helpers';

// 段階1-C(決済)のテストの準備。公開したアルバムと写真を DB と代わりの置き場所に直接入れる
// (1-A の公開の API を使わない。docs/photo-stage1-brief.md 6章)

export const NOW = '2026-11-03T10:00:00+09:00';
export const BUYER = 'U901:かい';
export const OTHER = 'U902:ほか';

export async function enablePhotoSales() {
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('photo_sales_enabled', 'true', ?)").bind(NOW).run();
}

/** 決まった中身のバイト列(写真の原本の代わり) */
export function bytesOf(n: number, seed = 7): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(n));
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

let seq = 0;

/** 写真を1枚入れる(原本は代わりの置き場所に。大きいものは部分に分けない、そのままの1ファイル) */
export async function seedPhoto(opts: { bytes?: number; filename?: string } = {}): Promise<{ photoId: number; originalKey: string; sha256: string; bytes: Uint8Array }> {
  seq++;
  const bytes = bytesOf(opts.bytes ?? 2048, seq * 13 + 1);
  const key = `originals/${crypto.randomUUID()}/${crypto.randomUUID()}.jpg`;
  const storage = photoStorage(env)!;
  await storage.put(key, bytes, 'image/jpeg');
  const sha = await sha256Hex(bytes);
  const row = await env.DB.prepare(
    `INSERT INTO photos (original_key, sha256, bytes, content_type, original_filename, status, sha256_verified_at, created_at, uploaded_at)
     VALUES (?, ?, ?, 'image/jpeg', ?, 'ready', ?, ?, ?) RETURNING id`,
  )
    .bind(key, sha, bytes.byteLength, opts.filename ?? `IMG_${String(1000 + seq).padStart(4, '0')}.JPG`, NOW, NOW, NOW)
    .first<{ id: number }>();
  return { photoId: row!.id, originalKey: key, sha256: sha, bytes };
}

export type SeedAlbumOptions = {
  name?: string;
  kind?: 'date' | 'event';
  /** 1枚の価格(価格表を新しく作る) */
  unitPrice?: number;
  /** まるごとの価格(null = まるごとでは買えない) */
  albumPrice?: number | null;
  photos?: number;
  status?: 'draft' | 'published' | 'ended';
  publishedAt?: string;
  saleEndsAt?: string | null;
};

/** 公開中のアルバムと、公開中の写真を入れる */
export async function seedAlbum(opts: SeedAlbumOptions = {}): Promise<{ albumId: number; photoIds: number[]; priceListId: number }> {
  const pl = await env.DB.prepare(
    `INSERT INTO price_lists (name, unit_price, album_price, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?) RETURNING id`,
  )
    .bind(`テスト${++seq}`, opts.unitPrice ?? 500, opts.albumPrice === undefined ? null : opts.albumPrice, NOW, NOW)
    .first<{ id: number }>();
  const publishedAt = opts.publishedAt ?? '2026-11-01T09:00:00+09:00';
  const status = opts.status ?? 'published';
  const album = await env.DB.prepare(
    `INSERT INTO albums (name, kind, event_date, price_list_id, status, published_at, sale_ends_at, created_at, updated_at)
     VALUES (?, ?, '2026-11-01', ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(
      opts.name ?? `アルバム${seq}`,
      opts.kind ?? 'date',
      pl!.id,
      status,
      status === 'draft' ? null : publishedAt,
      opts.saleEndsAt === undefined ? '2027-05-01T09:00:00+09:00' : opts.saleEndsAt,
      NOW,
      NOW,
    )
    .first<{ id: number }>();
  const photoIds: number[] = [];
  for (let i = 0; i < (opts.photos ?? 3); i++) {
    const p = await seedPhoto();
    await addToAlbum(album!.id, p.photoId, { status: status === 'draft' ? 'draft' : 'published', publishedAt, sortOrder: i + 1 });
    photoIds.push(p.photoId);
  }
  return { albumId: album!.id, photoIds, priceListId: pl!.id };
}

/** 写真をアルバムに載せる(同じ写真を別のアルバムにも載せられる) */
export async function addToAlbum(
  albumId: number,
  photoId: number,
  opts: { status?: 'draft' | 'published' | 'hidden' | 'removed'; publishedAt?: string | null; sortOrder?: number; priceOverride?: number | null } = {},
) {
  const status = opts.status ?? 'published';
  await env.DB.prepare(
    `INSERT INTO album_photos (album_id, photo_id, sort_order, status, price_override, published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(albumId, photoId, opts.sortOrder ?? 99, status, opts.priceOverride ?? null, opts.publishedAt === undefined ? (status === 'published' ? '2026-11-01T09:00:00+09:00' : null) : opts.publishedAt, NOW, NOW)
    .run();
}

export type CartItemInput = { kind: 'photo'; albumId: number; photoId: number } | { kind: 'album'; albumId: number };

export const addItems = (items: CartItemInput[], user = BUYER, now = NOW) => call('/api/photos/cart/items', { user, body: { items }, now });
export const getCart = (user = BUYER, now = NOW) => call('/api/photos/cart', { user, now });
export const checkout = (user = BUYER, opts: { now?: string; key?: string } = {}) =>
  call('/api/photos/checkout', { user, body: {}, now: opts.now ?? NOW, headers: opts.key ? { 'idempotency-key': opts.key } : {} });

/** まねの支払いの画面の「支払う」 */
export async function payMock(sessionIdOrUrl: string, user = BUYER, now = NOW) {
  const sessionId = sessionIdOrUrl.split('/').pop()!;
  return call(`/api/photos/mock-stripe/sessions/${sessionId}/pay`, { user, body: {}, now });
}

/** カートに入れて、購入手続きをして、まねで支払う。注文の番号を返す */
export async function buy(items: CartItemInput[], user = BUYER, now = NOW): Promise<number> {
  const add = await addItems(items, user, now);
  if (add.status !== 200) throw new Error(`カートに入れられません: ${JSON.stringify(add.body)}`);
  const co = await checkout(user, { now });
  if (co.status !== 200) throw new Error(`購入手続きができません: ${JSON.stringify(co.body)}`);
  const pay = await payMock(co.body.checkoutUrl, user, now);
  if (pay.status !== 200) throw new Error(`支払えません: ${JSON.stringify(pay.body)}`);
  return co.body.orderId;
}

export async function entitlementsOf(user = BUYER): Promise<{ photo_id: number; order_item_id: number; revoked_at: string | null }[]> {
  const { results } = await env.DB.prepare(
    `SELECT e.photo_id, e.order_item_id, e.revoked_at FROM entitlements e JOIN photo_customers c ON c.id = e.customer_id
      WHERE c.line_user_id = ? ORDER BY e.photo_id`,
  )
    .bind(user.split(':')[0])
    .all<{ photo_id: number; order_item_id: number; revoked_at: string | null }>();
  return results;
}
