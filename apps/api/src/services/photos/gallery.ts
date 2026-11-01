import {
  isOnSale,
  photoPreviewUrl,
  photoThumbUrl,
  resolveAlbumPrice,
  resolvePhotoPrice,
  type AlbumKind,
  type GalleryAlbum,
  type GalleryAlbumDetail,
  type GalleryAlbumsResponse,
} from '@dr/shared';

// 段階1-B ギャラリー(PF-5。PU-2〜PU-4)の読み出し。docs/photo-requirements.md 6.1。
// お客さんに見せるのは「公開中で販売期間中のアルバム」の「公開中の写真」だけ。それ以外は見つからない(404)として扱う。
// 返すのは透かし付きのサムネイル・プレビューの URL だけ。原本・中サイズ・購入済み領域のキーは、決して返さない。

/** お客さんに見せてよい写真の条件(album_photos を ap、photos を p として) */
export const VISIBLE_PHOTO_SQL = `ap.status = 'published' AND p.status = 'ready' AND p.files_deleted_at IS NULL
  AND p.thumb_key IS NOT NULL AND p.preview_key IS NOT NULL`;

type AlbumRow = {
  id: number;
  name: string;
  kind: AlbumKind;
  event_date: string;
  status: string;
  sale_ends_at: string | null;
  unit_price: number;
  album_price: number | null;
  photo_count: number;
  cover_id: number | null;
};

const ALBUM_SELECT = `
  SELECT a.id, a.name, a.kind, a.event_date, a.status, a.sale_ends_at, pl.unit_price, pl.album_price,
         (SELECT COUNT(*) FROM album_photos ap JOIN photos p ON p.id = ap.photo_id
           WHERE ap.album_id = a.id AND ${VISIBLE_PHOTO_SQL}) AS photo_count,
         COALESCE(
           (SELECT ap.photo_id FROM album_photos ap JOIN photos p ON p.id = ap.photo_id
             WHERE ap.album_id = a.id AND ap.photo_id = a.cover_photo_id AND ${VISIBLE_PHOTO_SQL}),
           (SELECT ap.photo_id FROM album_photos ap JOIN photos p ON p.id = ap.photo_id
             WHERE ap.album_id = a.id AND ${VISIBLE_PHOTO_SQL} ORDER BY ap.sort_order, ap.photo_id LIMIT 1)
         ) AS cover_id
    FROM albums a JOIN price_lists pl ON pl.id = a.price_list_id
   WHERE a.status = 'published' AND a.removed_at IS NULL AND a.ended_at IS NULL`;

/** 販売中か(公開中・一覧から外していない・販売終了の日時より前) */
const onSale = (r: Pick<AlbumRow, 'status' | 'sale_ends_at'>, now: Date) => isOnSale({ status: r.status, saleEndsAt: r.sale_ends_at }, now);

function toGalleryAlbum(r: AlbumRow): GalleryAlbum {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    eventDate: r.event_date,
    saleEndsAt: r.sale_ends_at,
    photoCount: r.photo_count,
    coverThumbUrl: r.cover_id ? photoThumbUrl(r.id, r.cover_id) : null,
    unitPrice: r.unit_price,
    albumPrice: resolveAlbumPrice({ albumPrice: r.album_price }),
  };
}

/**
 * 公開中・販売中のアルバム(開催日の新しい順)。写真が1枚も見せられないアルバムは出さない。
 * months は、種類で絞ったあとのアルバムの開催月(年月の絞り込みに出す。新しい順)
 */
export async function listGalleryAlbums(
  db: D1Database,
  query: { kind?: AlbumKind; month?: string },
  now: Date,
): Promise<GalleryAlbumsResponse> {
  const { results } = await db.prepare(`${ALBUM_SELECT} ORDER BY a.event_date DESC, a.id DESC`).all<AlbumRow>();
  const byKind = results.filter((r) => onSale(r, now) && r.photo_count > 0 && (!query.kind || r.kind === query.kind));
  const months = [...new Set(byKind.map((r) => r.event_date.slice(0, 7)))].sort().reverse();
  const albums = byKind.filter((r) => !query.month || r.event_date.startsWith(`${query.month}-`)).map(toGalleryAlbum);
  return { albums, months };
}

/** お客さんに見せてよいアルバム(販売中)。そうでなければ null */
async function findOnSaleAlbum(db: D1Database, albumId: number, now: Date): Promise<AlbumRow | null> {
  const row = await db.prepare(`${ALBUM_SELECT} AND a.id = ?`).bind(albumId).first<AlbumRow>();
  if (!row || !onSale(row, now)) return null;
  return row;
}

type PhotoRow = { photo_id: number; price_override: number | null; width: number | null; height: number | null };

/**
 * アルバムの公開中の写真(並び順)、価格、購入済みの印、まるごと購入できるか。販売中でなければ null(404)。
 * 購入済みは、その購入者の有効な権利(entitlements.revoked_at IS NULL)だけから決める(ほかの人・家族の購入は印にしない)
 */
export async function galleryAlbumDetail(db: D1Database, albumId: number, customerId: number, now: Date): Promise<GalleryAlbumDetail | null> {
  const album = await findOnSaleAlbum(db, albumId, now);
  if (!album) return null;
  const [photos, owned] = await db.batch([
    db
      .prepare(
        `SELECT ap.photo_id, ap.price_override, p.width, p.height
           FROM album_photos ap JOIN photos p ON p.id = ap.photo_id
          WHERE ap.album_id = ? AND ${VISIBLE_PHOTO_SQL}
          ORDER BY ap.sort_order, ap.photo_id`,
      )
      .bind(albumId),
    db
      .prepare(
        `SELECT DISTINCT e.photo_id FROM entitlements e
          WHERE e.customer_id = ? AND e.revoked_at IS NULL
            AND e.photo_id IN (SELECT photo_id FROM album_photos WHERE album_id = ?)`,
      )
      .bind(customerId, albumId),
  ]);
  const ownedIds = new Set((owned!.results as { photo_id: number }[]).map((r) => r.photo_id));
  const list = (photos!.results as PhotoRow[]).map((p) => ({
    photoId: p.photo_id,
    price: resolvePhotoPrice({ priceOverride: p.price_override, unitPrice: album.unit_price }),
    thumbUrl: photoThumbUrl(albumId, p.photo_id),
    previewUrl: photoPreviewUrl(albumId, p.photo_id),
    width: p.width,
    height: p.height,
    purchased: ownedIds.has(p.photo_id),
  }));
  const albumPrice = resolveAlbumPrice({ albumPrice: album.album_price });
  return {
    album: toGalleryAlbum(album),
    photos: list,
    canBuyAlbum: albumPrice !== null && list.some((p) => !p.purchased),
  };
}

export type GalleryMediaKind = 'thumb' | 'preview';

/**
 * 透かし付きのサムネイル・プレビューのキー。販売中のアルバムの、公開中の写真だけ。そうでなければ null(404)。
 * 原本(original_key)・中サイズ(view_key)・購入済み領域(purchased_key)は、ここからは決して選ばない
 */
export async function galleryMediaKey(db: D1Database, albumId: number, photoId: number, kind: GalleryMediaKind, now: Date): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT a.status, a.sale_ends_at, p.thumb_key, p.preview_key
         FROM album_photos ap
         JOIN albums a ON a.id = ap.album_id
         JOIN photos p ON p.id = ap.photo_id
        WHERE ap.album_id = ? AND ap.photo_id = ? AND a.status = 'published' AND a.removed_at IS NULL AND a.ended_at IS NULL
          AND ${VISIBLE_PHOTO_SQL}`,
    )
    .bind(albumId, photoId)
    .first<{ status: string; sale_ends_at: string | null; thumb_key: string; preview_key: string }>();
  if (!row || !onSale(row, now)) return null;
  return kind === 'thumb' ? row.thumb_key : row.preview_key;
}

/** 画像の ETag(キーから作る。キーは中身が変わると新しくなるので、確かめに来たときは読まずに 304 を返せる) */
export async function galleryEtag(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`gallery:${key}`));
  return `"${[...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')}"`;
}
