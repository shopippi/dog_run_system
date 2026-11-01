import { SELF, env } from 'cloudflare:test';
import { PHOTO_FALLBACK_PREFIX, sha256Hex } from '@dr/shared';
import { BASE, adminCall, createStaff, login } from './helpers';

// 段階1-A(管理)のテストの補助。写真を DB と代わりの置き場所に直接入れる・注文と購入の権利を入れる・バイトを PUT する

export const NOW = '2026-11-03T10:00:00+09:00';

export async function enablePhotoSales() {
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('photo_sales_enabled', 'true', ?)").bind(NOW).run();
}

export async function staffCookies() {
  await createStaff('admin@example.com', 'admin');
  await createStaff('staff@example.com', 'staff');
  await createStaff('dev@example.com', 'developer');
  return {
    admin: await login('admin@example.com'),
    staff: await login('staff@example.com'),
    developer: await login('dev@example.com'),
  };
}

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

/** アルバムを DB に直接作る */
export async function insertAlbum(a: { name?: string; kind?: 'date' | 'event'; status?: string; priceListId?: number; publishedAt?: string | null; saleEndsAt?: string | null } = {}) {
  const r = await env.DB.prepare(
    `INSERT INTO albums (name, kind, event_date, price_list_id, status, published_at, sale_ends_at, created_at, updated_at)
     VALUES (?, ?, '2026-11-02', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(a.name ?? '2026/11/02', a.kind ?? 'date', a.priceListId ?? 1, a.status ?? 'draft', a.publishedAt ?? null, a.saleEndsAt ?? null, NOW, NOW)
    .run();
  return r.meta.last_row_id;
}

let seq = 0;
/** 写真を1枚、DB と代わりの置き場所に直接入れ、アルバムに載せる */
export async function insertPhoto(albumId: number, opts: { status?: string; filename?: string; sortOrder?: number } = {}) {
  seq += 1;
  const bytes = bytesOf(1000 + seq, seq);
  const keys = { o: `originals/t${seq}/o.jpg`, p: `preview/t${seq}/p.jpg`, t: `thumb/t${seq}/t.jpg`, v: `view/t${seq}/v.jpg` };
  for (const k of Object.values(keys)) await env.MEDIA.put(PHOTO_FALLBACK_PREFIX + k, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  const r = await env.DB.prepare(
    `INSERT INTO photos (original_key, preview_key, thumb_key, view_key, sha256, bytes, content_type, original_filename, status, created_at, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, 'image/jpeg', ?, 'ready', ?, ?)`,
  )
    .bind(keys.o, keys.p, keys.t, keys.v, await sha256Hex(bytes), bytes.byteLength, opts.filename ?? `IMG_${seq}.JPG`, NOW, NOW)
    .run();
  const photoId = r.meta.last_row_id;
  await addToAlbum(albumId, photoId, opts.status ?? 'draft', opts.sortOrder ?? seq);
  return photoId;
}

export async function addToAlbum(albumId: number, photoId: number, status = 'draft', sortOrder = 1) {
  await env.DB.prepare(
    `INSERT INTO album_photos (album_id, photo_id, sort_order, status, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(albumId, photoId, sortOrder, status, status === 'published' ? NOW : null, NOW, NOW)
    .run();
}

/** お支払い済みの注文と購入の権利を入れる(1-C の Webhook の代わり) */
export async function insertSale(albumId: number, photoId: number, unitPrice = 500) {
  const cust = await env.DB.prepare(
    "INSERT INTO photo_customers (line_user_id, display_name, created_at, updated_at) VALUES (?, 'お客さん', ?, ?)",
  )
    .bind(`U-sale-${albumId}-${photoId}-${Math.random()}`, NOW, NOW)
    .run();
  const customerId = cust.meta.last_row_id;
  const order = await env.DB.prepare(
    "INSERT INTO orders (customer_id, status, amount, payment_mode, paid_at, created_at, updated_at) VALUES (?, 'paid', ?, 'mock', ?, ?, ?)",
  )
    .bind(customerId, unitPrice, NOW, NOW, NOW)
    .run();
  const item = await env.DB.prepare("INSERT INTO order_items (order_id, kind, album_id, photo_id, unit_price, label) VALUES (?, 'photo', ?, ?, ?, '写真')")
    .bind(order.meta.last_row_id, albumId, photoId, unitPrice)
    .run();
  await env.DB.prepare('INSERT INTO entitlements (customer_id, photo_id, order_item_id, granted_at) VALUES (?, ?, ?, ?)')
    .bind(customerId, photoId, item.meta.last_row_id, NOW)
    .run();
  return { orderId: order.meta.last_row_id, orderItemId: item.meta.last_row_id };
}

/** 送り先(UploadTarget)へバイトを PUT する。代わりの置き場所の Worker の URL は、テストの宛先に置き換える */
export async function putTo(target: { url: string; headers: Record<string, string> }, body: Uint8Array, cookie: string) {
  const u = new URL(target.url);
  const res = await SELF.fetch(`${BASE}${u.pathname}${u.search}`, {
    method: 'PUT',
    headers: { ...target.headers, cookie },
    body,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

/** 操作ログの最後の行 */
export async function lastAudit(action: string) {
  return env.DB.prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1').bind(action).first<any>();
}

export async function undo(cookie: string, auditId: number) {
  return adminCall(`/admin/api/audit/${auditId}/undo`, { cookie, body: {} });
}

export { adminCall };
