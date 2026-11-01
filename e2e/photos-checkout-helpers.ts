import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import { authHeaders } from './customer-helpers';
import { putMedia, sql } from './merge-helpers';

// 段階1-C(決済)の e2e の準備。公開したアルバムと写真を、テスト用のデータベースと写真の置き場所(代わりの置き場所)に直接入れる
// (1-A のアップロード・公開の画面は段階2で通しにする。docs/photo-stage1-brief.md 6章)

export function enablePhotoSales() {
  sql(
    "INSERT INTO settings (key, value, updated_at) VALUES ('photo_sales_enabled', 'true', '2026-11-01T00:00:00+09:00') ON CONFLICT (key) DO UPDATE SET value = 'true'",
  );
}

export type SeededAlbum = { albumId: number; photoIds: number[] };

/** 公開中のアルバム(価格表を新しく作る)と、公開中の写真を入れる。原本は代わりの置き場所に置く */
export function seedAlbum(opts: { name: string; unitPrice: number; albumPrice?: number | null; photos: number; filenames?: string[] }): SeededAlbum {
  const tag = randomUUID().slice(0, 8);
  sql(
    `INSERT INTO price_lists (name, unit_price, album_price, status, created_at, updated_at)
     VALUES ('e2e-${tag}', ${opts.unitPrice}, ${opts.albumPrice ?? 'NULL'}, 'active', '2026-11-01T00:00:00+09:00', '2026-11-01T00:00:00+09:00')`,
  );
  sql(
    `INSERT INTO albums (name, kind, event_date, price_list_id, status, published_at, sale_ends_at, created_at, updated_at)
     SELECT '${opts.name.replace(/'/g, "''")}', 'event', '2026-11-01', id, 'published', '2026-11-01T09:00:00+09:00', '2099-01-01T00:00:00+09:00', '2026-11-01T00:00:00+09:00', '2026-11-01T00:00:00+09:00'
       FROM price_lists WHERE name = 'e2e-${tag}'`,
  );
  const albumId = sql(`SELECT a.id FROM albums a JOIN price_lists p ON p.id = a.price_list_id WHERE p.name = 'e2e-${tag}'`)[0]!.id as number;
  const photoIds: number[] = [];
  for (let i = 0; i < opts.photos; i++) {
    const bytes = randomBytes(1500 + i);
    const key = `originals/${randomUUID()}/${randomUUID()}.jpg`;
    putMedia(`photo-sales/${key}`, bytes);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const filename = opts.filenames?.[i] ?? `IMG_${String(2001 + i)}.JPG`;
    sql(
      `INSERT INTO photos (original_key, sha256, bytes, content_type, original_filename, status, sha256_verified_at, created_at, uploaded_at)
       VALUES ('${key}', '${sha}', ${bytes.byteLength}, 'image/jpeg', '${filename}', 'ready', '2026-11-01T09:00:00+09:00', '2026-11-01T09:00:00+09:00', '2026-11-01T09:00:00+09:00')`,
    );
    const photoId = sql(`SELECT id FROM photos WHERE original_key = '${key}'`)[0]!.id as number;
    sql(
      `INSERT INTO album_photos (album_id, photo_id, sort_order, status, published_at, created_at, updated_at)
       VALUES (${albumId}, ${photoId}, ${i + 1}, 'published', '2026-11-01T09:00:00+09:00', '2026-11-01T09:00:00+09:00', '2026-11-01T09:00:00+09:00')`,
    );
    photoIds.push(photoId);
  }
  return { albumId, photoIds };
}

export type CartItemInput = { kind: 'photo'; albumId: number; photoId: number } | { kind: 'album'; albumId: number };

/**
 * カートに入れる(アルバムの画面で写真を選んで「カートに入れる」と同じ API。画面は 1-B の担当)。
 * 応答の added と skipped を返す
 */
export async function addToCartApi(request: APIRequestContext, user: string, items: CartItemInput[]) {
  const res = await request.post('/api/photos/cart/items', { headers: { ...authHeaders(user), 'idempotency-key': randomUUID() }, data: { items } });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as { added: number; skipped: { reason: string }[]; total: number };
}

/** 購入手続きをして、お支払い待ちの注文を作る(まねの支払いはしない) */
export async function checkoutApi(request: APIRequestContext, user: string) {
  const res = await request.post('/api/photos/checkout', { headers: { ...authHeaders(user), 'idempotency-key': randomUUID() }, data: {} });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as { orderId: number; checkoutUrl: string; amount: number };
}

/** まねの支払いの「支払う」 */
export async function payMockApi(request: APIRequestContext, user: string, checkoutUrl: string) {
  const sessionId = checkoutUrl.split('/').pop()!;
  const res = await request.post(`/api/photos/mock-stripe/sessions/${sessionId}/pay`, { headers: { ...authHeaders(user), 'idempotency-key': randomUUID() }, data: {} });
  expect(res.status(), await res.text()).toBe(200);
}

/** よく使う形: 2つのアルバム(1枚ずつのアルバムと、まるごとで買えるアルバム) */
export function seedTwoAlbums(prefix = '') {
  const a = seedAlbum({ name: `${prefix}11月1日のドッグラン`, unitPrice: 500, photos: 3 });
  const b = seedAlbum({ name: `${prefix}秋のわんわん運動会`, unitPrice: 800, albumPrice: 2000, photos: 2 });
  return { a, b };
}
