import { expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  cartAddResponseSchema,
  cartAddSchema,
  cartResponseSchema,
  type CartAddResponse,
  type CartItemView,
  type CartResponse,
} from '../packages/shared/src/photos/schemas';
import { adminApiLogin } from './booking-helpers';
import { sql } from './merge-helpers';

// 段階1-B ギャラリー(PU-2〜PU-4)の e2e の準備(liff.photos-gallery-*.spec.ts・contrast-photos-gallery.spec.ts で使う)。
// - アルバムと写真は、1-A のアップロードを待たずに DB へ直接入れる。透かし付きのサムネイル・プレビューは、
//   代わりの置き場所の受け取り口(PUT /admin/api/photos/uploads/:id/derivatives/:kind。段階0の共通の口)で入れる
// - カートの API(1-C)がまだ 501 のあいだは、画面の通しの操作を確かめるため、page.route でまねる。
//   まねの中身は共通の形(cartAddSchema・cartAddResponseSchema)で確かめるので、1-C の API とそのままつながる

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%S+09:00', 'now', '+9 hours')";
const FAR = '2099-12-31T23:59:59+09:00';

export type SeededAlbum = { albumId: number; name: string; photoIds: number[] };

/** 販売を始める(テストの最後に stopPhotoSales で戻す。ほかの spec は「準備中」を前提にしている) */
export function startPhotoSales() {
  sql(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('photo_sales_enabled', 'true', ${NOW_SQL})`);
}
export function stopPhotoSales() {
  sql("DELETE FROM settings WHERE key = 'photo_sales_enabled'");
}

/** 見本の写真(JPEG)。番号ごとに色と数字を変え、透かしの代わりに「SAMPLE」を斜めに入れる */
async function sampleJpeg(page: Page, n: number, longEdge: number): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ([n, longEdge]) => {
      const w = longEdge;
      const h = Math.round((longEdge * 2) / 3);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d')!;
      const hue = (n * 47) % 360;
      g.fillStyle = `hsl(${hue} 35% 62%)`;
      g.fillRect(0, 0, w, h);
      g.fillStyle = `hsl(${hue} 30% 32%)`;
      g.beginPath();
      g.ellipse(w * 0.5, h * 0.62, w * 0.22, h * 0.24, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(w * 0.5, h * 0.34, h * 0.16, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.9)';
      g.font = `600 ${Math.round(h * 0.16)}px sans-serif`;
      g.fillText(String(n), w * 0.06, h * 0.22);
      g.save();
      g.translate(w / 2, h / 2);
      g.rotate(-Math.PI / 8);
      g.fillStyle = 'rgba(255,255,255,.35)';
      g.font = `600 ${Math.round(h * 0.09)}px sans-serif`;
      for (let y = -h; y < h; y += h * 0.3) for (let x = -w; x < w; x += w * 0.45) g.fillText('SAMPLE', x, y);
      g.restore();
      return c.toDataURL('image/jpeg', 0.7);
    },
    [n, longEdge] as const,
  );
  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
}

/**
 * 公開中のアルバムを作る。albumPrice を渡すと、その「まるごと」の価格の価格表を作って使う。
 * page は見本の写真を描くのに使う(about:blank でよい)
 */
export async function seedGalleryAlbum(
  page: Page,
  request: APIRequestContext,
  opts: { name: string; kind?: 'date' | 'event'; eventDate: string; photos: number; albumPrice?: number; unitPrice?: number; firstPriceOverride?: number },
): Promise<SeededAlbum> {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let priceListId = opts.kind === 'event' ? 2 : 1;
  if (opts.albumPrice || opts.unitPrice) {
    priceListId = sql(
      `INSERT INTO price_lists (name, unit_price, album_price, status, created_at, updated_at)
       VALUES ('e2e ${tag}', ${opts.unitPrice ?? 500}, ${opts.albumPrice ?? 'NULL'}, 'active', ${NOW_SQL}, ${NOW_SQL}) RETURNING id`,
    )[0]!.id as number;
  }
  const albumId = sql(
    `INSERT INTO albums (name, kind, event_date, price_list_id, status, published_at, sale_ends_at, created_at, updated_at)
     VALUES ('${opts.name.replaceAll("'", "''")}', '${opts.kind ?? 'date'}', '${opts.eventDate}', ${priceListId}, 'published', ${NOW_SQL}, '${FAR}', ${NOW_SQL}, ${NOW_SQL})
     RETURNING id`,
  )[0]!.id as number;
  const rows: string[] = [];
  for (let i = 0; i < opts.photos; i++) {
    const k = `${tag}-${i}`;
    rows.push(
      `('originals/${k}/o.jpg', 'preview/${k}/p.jpg', 'thumb/${k}/t.jpg', 'view/${k}/v.jpg', '${'a'.repeat(64)}', 1000, 'image/jpeg', 1200, 800, 'IMG_${k}.JPG', 'ready', ${NOW_SQL}, ${NOW_SQL})`,
    );
  }
  const photoIds = sql(
    `INSERT INTO photos (original_key, preview_key, thumb_key, view_key, sha256, bytes, content_type, width, height, original_filename, status, created_at, uploaded_at)
     VALUES ${rows.join(', ')} RETURNING id`,
  ).map((r) => r.id as number);
  const aps = photoIds.map(
    (id, i) =>
      `(${albumId}, ${id}, ${i + 1}, 'published', ${i === 0 && opts.firstPriceOverride ? opts.firstPriceOverride : 'NULL'}, ${NOW_SQL}, ${NOW_SQL}, ${NOW_SQL})`,
  );
  const ups = photoIds.map((id, i) => `('up-${tag}-${i}', ${id}, ${albumId}, 'fallback', 1572864, 1, '[]', 'uploading', ${NOW_SQL}, ${NOW_SQL})`);
  sql(
    `INSERT INTO album_photos (album_id, photo_id, sort_order, status, price_override, published_at, created_at, updated_at) VALUES ${aps.join(', ')};
     UPDATE albums SET cover_photo_id = ${photoIds[0]} WHERE id = ${albumId};
     INSERT INTO photo_uploads (id, photo_id, album_id, storage, part_size, part_count, derivatives, status, created_at, updated_at) VALUES ${ups.join(', ')};`,
  );
  // 透かし付きのサムネイル・プレビューを、代わりの置き場所の受け取り口で入れる
  await adminApiLogin(request, 'admin');
  for (const [i] of photoIds.entries()) {
    for (const [kind, edge] of [['thumb', 400], ['preview', 1200]] as const) {
      const res = await request.put(`/admin/api/photos/uploads/up-${tag}-${i}/derivatives/${kind}`, {
        headers: { 'x-dr-admin': '1', 'content-type': 'image/jpeg' },
        data: await sampleJpeg(page, i + 1, edge),
      });
      expect(res.status(), await res.text()).toBe(200);
    }
  }
  sql(`UPDATE photo_uploads SET status = 'completed', completed_at = ${NOW_SQL} WHERE id LIKE 'up-${tag}-%'`);
  return { albumId, name: opts.name, photoIds };
}

/** テストで作ったアルバムを一覧から外す(ほかの spec に残さない。行は消さない) */
export function retireAlbums(albums: SeededAlbum[]) {
  if (albums.length) sql(`UPDATE albums SET removed_at = ${NOW_SQL} WHERE id IN (${albums.map((a) => a.albumId).join(',')})`);
}

/** 権利を直接入れる(1-C の Webhook を待たずに「購入済み」を作る) */
export function grantPhoto(lineUserId: string, displayName: string, albumId: number, photoId: number) {
  sql(
    `INSERT INTO photo_customers (line_user_id, display_name, created_at, updated_at) VALUES ('${lineUserId}', '${displayName}', ${NOW_SQL}, ${NOW_SQL})
       ON CONFLICT (line_user_id) WHERE line_user_id IS NOT NULL DO NOTHING;
     INSERT INTO orders (customer_id, status, amount, payment_mode, paid_at, created_at, updated_at)
       SELECT id, 'paid', 500, 'mock', ${NOW_SQL}, ${NOW_SQL}, ${NOW_SQL} FROM photo_customers WHERE line_user_id = '${lineUserId}';
     INSERT INTO order_items (order_id, kind, album_id, photo_id, unit_price, label) VALUES (last_insert_rowid(), 'photo', ${albumId}, ${photoId}, 500, '写真');
     INSERT INTO entitlements (customer_id, photo_id, order_item_id, granted_at)
       SELECT (SELECT id FROM photo_customers WHERE line_user_id = '${lineUserId}'), ${photoId}, last_insert_rowid(), ${NOW_SQL};`,
  );
}

/**
 * カートの API(1-C)のまね。GET /api/photos/cart と POST /api/photos/cart/items だけ。
 * 送られた中身は cartAddSchema で確かめ、返す中身は cartAddResponseSchema・cartResponseSchema で確かめる
 */
export async function mockCartApi(page: Page) {
  const items: CartItemView[] = [];
  const posts: unknown[] = [];
  const view = (): CartResponse => cartResponseSchema.parse({ items, total: items.reduce((s, i) => s + i.unitPrice, 0), payableCount: items.length });
  await page.route('**/api/photos/cart', (route) => route.fulfill({ json: view() }));
  await page.route('**/api/photos/cart/items', async (route) => {
    const body = route.request().postDataJSON();
    posts.push(body);
    const input = cartAddSchema.parse(body);
    let added = 0;
    const skipped: CartAddResponse['skipped'] = [];
    for (const it of input.items) {
      const dup = items.some((x) => (it.kind === 'album' ? x.kind === 'album' && x.albumId === it.albumId : x.photoId === it.photoId));
      if (dup) {
        skipped.push({ item: it, reason: 'already_in_cart', message: 'すでにカートにあります' });
        continue;
      }
      added++;
      items.push({
        id: items.length + 1,
        kind: it.kind,
        albumId: it.albumId,
        photoId: it.kind === 'photo' ? it.photoId : null,
        albumName: 'アルバム',
        label: it.kind === 'photo' ? `写真 ${it.photoId}` : 'アルバムまるごと',
        unitPrice: 500,
        thumbUrl: null,
        photoCount: it.kind === 'album' ? 1 : null,
        state: 'ok',
        reason: null,
        message: null,
        addedAt: '2026-11-03T10:00:00+09:00',
      });
    }
    await route.fulfill({ json: cartAddResponseSchema.parse({ ...view(), added, skipped }) });
  });
  return { items, posts };
}
