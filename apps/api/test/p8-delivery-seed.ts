import { env } from 'cloudflare:test';
import { sha256Hex, toJstIso } from '@dr/shared';
import type { Bindings } from '../src/env';
import { ensurePhotoCustomer } from '../src/lib/photos/customers';
import { photoStorage, type PhotoStorage } from '../src/lib/photos/storage';

// 段階1-D のテストの準備: 公開したアルバム・写真(代わりの置き場所)と、購入の権利を DB に直接入れる。
// 公開(1-A)とお支払い(1-C)の API ができる前でも、配信を確かめられるように(docs/photo-stage1-brief.md 6章)。

export const storage = (): PhotoStorage => photoStorage(env as unknown as Bindings)!;

/** 決まった中身のバイト列 */
export function bytesOf(n: number, seed = 7): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(n));
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

export async function enablePhotoSales(now = '2026-11-03T10:00:00+09:00') {
  await env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES ('photo_sales_enabled', 'true', ?) ON CONFLICT (key) DO UPDATE SET value = 'true'",
  )
    .bind(now)
    .run();
}

export type SeededPhoto = {
  id: number;
  original: Uint8Array<ArrayBuffer>;
  sha256: string;
  filename: string;
  keys: { original: string; preview: string; thumb: string; view: string };
};

/** 原本を代わりの置き場所に入れる。partSize より大きいときは、本物と同じく部分に分けて目次を書く */
async function putOriginal(s: PhotoStorage, key: string, bytes: Uint8Array<ArrayBuffer>, partSize: number) {
  const n = Math.max(1, Math.ceil(bytes.length / partSize));
  const parts: { partNumber: number; etag: string }[] = [];
  for (let i = 0; i < n; i++) {
    const chunk = bytes.slice(i * partSize, (i + 1) * partSize);
    const { etag } = await s.putPart!(key, i + 1, chunk.buffer);
    parts.push({ partNumber: i + 1, etag });
  }
  await s.completeMultipart(key, null, parts, 'image/jpeg', new Date());
}

/** 公開したアルバムと写真(ファイルつき)を作る */
export async function seedAlbum(opts: {
  name?: string;
  status?: 'draft' | 'published' | 'ended';
  saleEndsAt?: string | null;
  photos?: number;
  /** 原本の大きさ(写真ごと。省くと 2000 + i) */
  sizes?: number[];
  now?: string;
  /** 部分の大きさ(テストで部分に分けるため。省くと置き場所の既定) */
  partSize?: number;
}): Promise<{ albumId: number; photos: SeededPhoto[] }> {
  const now = opts.now ?? '2026-11-01T10:00:00+09:00';
  const s = storage();
  const album = await env.DB.prepare(
    `INSERT INTO albums (name, kind, event_date, price_list_id, status, published_at, sale_ends_at, created_at, updated_at)
     VALUES (?, 'date', '2026-11-01', 1, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(opts.name ?? '2026/11/01', opts.status ?? 'published', now, opts.saleEndsAt === undefined ? '2027-05-01T10:00:00+09:00' : opts.saleEndsAt, now, now)
    .first<{ id: number }>();
  const albumId = album!.id;
  const photos: SeededPhoto[] = [];
  const count = opts.photos ?? 3;
  for (let i = 0; i < count; i++) {
    const original = bytesOf(opts.sizes?.[i] ?? 2000 + i, albumId * 100 + i + 1);
    const u = () => crypto.randomUUID();
    const keys = {
      original: `originals/${u()}/${u()}.jpg`,
      preview: `preview/${u()}/${u()}.jpg`,
      thumb: `thumb/${u()}/${u()}.jpg`,
      view: `view/${u()}/${u()}.jpg`,
    };
    await putOriginal(s, keys.original, original, opts.partSize ?? s.partSize);
    await s.put(keys.preview, bytesOf(300, 900 + i), 'image/jpeg');
    await s.put(keys.thumb, bytesOf(100, 800 + i), 'image/jpeg');
    await s.put(keys.view, bytesOf(500, 700 + i), 'image/jpeg');
    const filename = `IMG_${String(1001 + i).padStart(4, '0')}.JPG`;
    const sha256 = await sha256Hex(original);
    const p = await env.DB.prepare(
      `INSERT INTO photos (original_key, preview_key, thumb_key, view_key, sha256, bytes, content_type, original_filename, status, sha256_verified_at, created_at, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, 'image/jpeg', ?, 'ready', ?, ?, ?) RETURNING id`,
    )
      .bind(keys.original, keys.preview, keys.thumb, keys.view, sha256, original.length, filename, now, now, now)
      .first<{ id: number }>();
    await env.DB.prepare(
      `INSERT INTO album_photos (album_id, photo_id, sort_order, status, published_at, created_at, updated_at) VALUES (?, ?, ?, 'published', ?, ?, ?)`,
    )
      .bind(albumId, p!.id, i + 1, now, now, now)
      .run();
    photos.push({ id: p!.id, original, sha256, filename, keys });
  }
  return { albumId, photos };
}

/** 載せる(ほかのアルバムにも同じ写真を) */
export async function addToAlbum(albumId: number, photoId: number, status = 'published') {
  const now = '2026-11-01T10:00:00+09:00';
  await env.DB.prepare(
    `INSERT INTO album_photos (album_id, photo_id, sort_order, status, published_at, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?)`,
  )
    .bind(albumId, photoId, status, now, now, now)
    .run();
}

/**
 * 購入した状態にする(お支払いの確定 = Webhook の結果と同じ形): 注文 paid・明細・権利、購入済み領域へのコピー。
 * user は 'U001:パパ' の形
 */
export async function purchase(
  user: string,
  albumId: number,
  photoIds: number[],
  opts: { paidAt?: string; amount?: number; status?: string; copy?: boolean } = {},
): Promise<{ customerId: number; orderId: number; itemIds: number[]; entitlementIds: number[] }> {
  const [userId, displayName = ''] = user.split(':');
  const paidAt = opts.paidAt ?? '2026-11-02T12:00:00+09:00';
  const customer = await ensurePhotoCustomer(env.DB, { userId: userId!, displayName }, new Date(paidAt));
  const order = await env.DB.prepare(
    `INSERT INTO orders (customer_id, status, amount, payment_mode, paid_at, created_at, updated_at)
     VALUES (?, ?, ?, 'mock', ?, ?, ?) RETURNING id`,
  )
    .bind(customer.id, opts.status ?? 'paid', opts.amount ?? 500 * photoIds.length, opts.status === 'pending' ? null : paidAt, paidAt, paidAt)
    .first<{ id: number }>();
  const s = storage();
  const itemIds: number[] = [];
  const entitlementIds: number[] = [];
  for (const photoId of photoIds) {
    const item = await env.DB.prepare(
      `INSERT INTO order_items (order_id, kind, album_id, photo_id, unit_price, label) VALUES (?, 'photo', ?, ?, 500, ?) RETURNING id`,
    )
      .bind(order!.id, albumId, photoId, `写真 ${photoId}`)
      .first<{ id: number }>();
    itemIds.push(item!.id);
    if (opts.status === 'pending') continue;
    const ent = await env.DB.prepare(
      `INSERT INTO entitlements (customer_id, photo_id, order_item_id, granted_at) VALUES (?, ?, ?, ?) RETURNING id`,
    )
      .bind(customer.id, photoId, item!.id, paidAt)
      .first<{ id: number }>();
    entitlementIds.push(ent!.id);
    if (opts.copy !== false) {
      const row = await env.DB.prepare('SELECT original_key, purchased_key FROM photos WHERE id = ?').bind(photoId).first<{ original_key: string; purchased_key: string | null }>();
      if (!row!.purchased_key) {
        const dst = `purchased/${crypto.randomUUID()}/${crypto.randomUUID()}.jpg`;
        await s.copy(row!.original_key, dst, new Date(paidAt));
        await env.DB.prepare('UPDATE photos SET purchased_key = ?, purchased_verified_at = ? WHERE id = ?').bind(dst, paidAt, photoId).run();
      }
    }
  }
  return { customerId: customer.id, orderId: order!.id, itemIds, entitlementIds };
}

/** 返金した状態にする(権利を無効に) */
export async function revoke(entitlementId: number, at = '2026-11-03T09:00:00+09:00') {
  await env.DB.prepare("UPDATE entitlements SET revoked_at = ?, revoke_reason = 'refund' WHERE id = ?").bind(at, entitlementId).run();
}

export const iso = (d: Date) => toJstIso(d);

/** バイトを全部読む */
export async function readAll(stream: ReadableStream | null | undefined): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream ?? null).arrayBuffer());
}

/** 無圧縮の ZIP を読む(中央ディレクトリから。ZIP64 にも対応)。名前と中身と CRC を返す */
export function parseStoreZip(buf: Uint8Array): { name: string; data: Uint8Array; crc: number; method: number }[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('EOCD がない');
  let count = dv.getUint16(eocd + 10, true);
  let cdOffset = dv.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20;
    if (dv.getUint32(loc, true) !== 0x07064b50) throw new Error('ZIP64 の目印がない');
    const z64 = Number(dv.getBigUint64(loc + 8, true));
    if (dv.getUint32(z64, true) !== 0x06064b50) throw new Error('ZIP64 の終わりがない');
    count = Number(dv.getBigUint64(z64 + 32, true));
    cdOffset = Number(dv.getBigUint64(z64 + 48, true));
  }
  const out: { name: string; data: Uint8Array; crc: number; method: number }[] = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('中央ディレクトリが壊れている');
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    let size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    let offset = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    // ZIP64 の追加の項目
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e < eEnd) {
      const id = dv.getUint16(e, true);
      const len = dv.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) {
          size = Number(dv.getBigUint64(q, true));
          q += 16;
        }
        if (offset === 0xffffffff) offset = Number(dv.getBigUint64(q, true));
      }
      e += 4 + len;
    }
    if (dv.getUint32(offset, true) !== 0x04034b50) throw new Error('ファイルの頭が壊れている');
    const lNameLen = dv.getUint16(offset + 26, true);
    const lExtraLen = dv.getUint16(offset + 28, true);
    const start = offset + 30 + lNameLen + lExtraLen;
    out.push({ name, data: buf.slice(start, start + size), crc, method });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
