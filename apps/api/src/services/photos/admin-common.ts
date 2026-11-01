import { adminPhotoThumbUrl, type AdminAlbum, type AlbumKind, type AlbumStatus } from '@dr/shared';
import { errors } from '../../lib/errors';

// 段階1-A(管理)の共通の部品。アルバムの行を画面の形にする・売れた写真を調べる。
// 「売れた写真」= そのアルバムの注文の明細から、有効な購入の権利(entitlements.revoked_at IS NULL)が付いている写真。
// 売れた写真はアルバムから外せない(非公開だけ。docs/photo-stage1-brief.md 2章)。

export type AlbumRow = {
  id: number;
  name: string;
  kind: AlbumKind;
  event_date: string;
  price_list_id: number;
  status: AlbumStatus;
  published_at: string | null;
  sale_ends_at: string | null;
  cover_photo_id: number | null;
  source_folder: string | null;
  ended_at: string | null;
  files_deleted_at: string | null;
  removed_at: string | null;
  created_at: string;
  updated_at: string;
};

export const ALBUM_COLUMNS = `a.id, a.name, a.kind, a.event_date, a.price_list_id, a.status, a.published_at, a.sale_ends_at, a.cover_photo_id,
  a.source_folder, a.ended_at, a.files_deleted_at, a.removed_at, a.created_at, a.updated_at`;

/** 一覧と詳細で使う、アルバムの集計つきの行 */
type AlbumStatRow = AlbumRow & {
  price_list_name: string;
  unit_price: number;
  album_price: number | null;
  n_draft: number;
  n_published: number;
  n_hidden: number;
  sales_yen: number;
  sold_photos: number;
  cover_thumb_id: number | null;
};

const ALBUM_STATS_SQL = `
  SELECT ${ALBUM_COLUMNS}, pl.name AS price_list_name, pl.unit_price, pl.album_price,
    (SELECT COUNT(*) FROM album_photos ap WHERE ap.album_id = a.id AND ap.status = 'draft') AS n_draft,
    (SELECT COUNT(*) FROM album_photos ap WHERE ap.album_id = a.id AND ap.status = 'published') AS n_published,
    (SELECT COUNT(*) FROM album_photos ap WHERE ap.album_id = a.id AND ap.status = 'hidden') AS n_hidden,
    (SELECT COALESCE(SUM(oi.unit_price - COALESCE(oi.refund_amount, 0)), 0)
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.album_id = a.id AND o.status IN ('paid', 'partially_refunded', 'refunded')) AS sales_yen,
    (SELECT COUNT(DISTINCT e.photo_id) FROM entitlements e JOIN order_items oi ON oi.id = e.order_item_id
      WHERE oi.album_id = a.id AND e.revoked_at IS NULL) AS sold_photos,
    COALESCE(
      (SELECT p.id FROM photos p JOIN album_photos ap ON ap.photo_id = p.id
        WHERE p.id = a.cover_photo_id AND ap.album_id = a.id AND ap.status != 'removed' AND p.thumb_key IS NOT NULL AND p.files_deleted_at IS NULL),
      (SELECT p.id FROM album_photos ap JOIN photos p ON p.id = ap.photo_id
        WHERE ap.album_id = a.id AND ap.status != 'removed' AND p.thumb_key IS NOT NULL AND p.files_deleted_at IS NULL
        ORDER BY ap.sort_order, ap.id LIMIT 1)
    ) AS cover_thumb_id
  FROM albums a JOIN price_lists pl ON pl.id = a.price_list_id`;

export function toAdminAlbum(r: AlbumStatRow): AdminAlbum {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    eventDate: r.event_date,
    status: r.status,
    priceListId: r.price_list_id,
    priceListName: r.price_list_name,
    publishedAt: r.published_at,
    saleEndsAt: r.sale_ends_at,
    coverThumbUrl: r.cover_thumb_id ? adminPhotoThumbUrl(r.cover_thumb_id) : null,
    counts: { draft: r.n_draft, published: r.n_published, hidden: r.n_hidden },
    salesYen: r.sales_yen,
    soldPhotos: r.sold_photos,
    filesDeletedAt: r.files_deleted_at,
  };
}

export async function listAlbumStats(
  db: D1Database,
  filter: { status?: AlbumStatus; kind?: AlbumKind; q?: string } = {},
): Promise<(AdminAlbum & { unitPrice: number; albumPrice: number | null; sourceFolder: string | null })[]> {
  const where = ['a.removed_at IS NULL'];
  const args: unknown[] = [];
  if (filter.status) {
    where.push('a.status = ?');
    args.push(filter.status);
  }
  if (filter.kind) {
    where.push('a.kind = ?');
    args.push(filter.kind);
  }
  if (filter.q) {
    where.push("(a.name LIKE ? ESCAPE '\\' OR a.source_folder LIKE ? ESCAPE '\\')");
    const like = `%${filter.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    args.push(like, like);
  }
  const { results } = await db
    .prepare(`${ALBUM_STATS_SQL} WHERE ${where.join(' AND ')} ORDER BY a.event_date DESC, a.id DESC`)
    .bind(...args)
    .all<AlbumStatRow>();
  return results.map((r) => ({ ...toAdminAlbum(r), unitPrice: r.unit_price, albumPrice: r.album_price, sourceFolder: r.source_folder }));
}

/** 1つのアルバム(一覧から外したものも返す)。無ければ 404 */
export async function albumStats(db: D1Database, id: number) {
  const r = await db.prepare(`${ALBUM_STATS_SQL} WHERE a.id = ?`).bind(id).first<AlbumStatRow>();
  if (!r) throw albumNotFound();
  return { ...toAdminAlbum(r), unitPrice: r.unit_price, albumPrice: r.album_price, sourceFolder: r.source_folder, removedAt: r.removed_at };
}

export const albumNotFound = () => errors.notFound('アルバムが見つかりませんでした。アルバムの一覧から選び直してください。');

export async function findAlbum(db: D1Database, id: number): Promise<AlbumRow> {
  if (!Number.isInteger(id) || id <= 0) throw albumNotFound();
  const r = await db.prepare(`SELECT ${ALBUM_COLUMNS} FROM albums a WHERE a.id = ?`).bind(id).first<AlbumRow>();
  if (!r) throw albumNotFound();
  return r;
}

/** 一覧から外したアルバムは、変えられない(先に戻す) */
export function assertNotRemoved(a: AlbumRow) {
  if (a.removed_at) {
    throw errors.conflict('album_removed', 'このアルバムは一覧から外してあります。先に「元に戻す」で戻してから操作してください。');
  }
}

/** このアルバムで売れた写真(有効な購入の権利がある写真)の番号 */
export async function soldPhotoIds(db: D1Database, albumId: number): Promise<Set<number>> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT e.photo_id FROM entitlements e JOIN order_items oi ON oi.id = e.order_item_id
        WHERE oi.album_id = ? AND e.revoked_at IS NULL`,
    )
    .bind(albumId)
    .all<{ photo_id: number }>();
  return new Set(results.map((r) => r.photo_id));
}

/** 文字の id を数にする(数でなければ 0。0 は見つからない扱い) */
export const toId = (s: string | undefined) => {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : 0;
};
