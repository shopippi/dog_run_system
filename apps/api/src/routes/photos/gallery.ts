import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { notImplemented } from '../../lib/photos/availability';

// 段階1-B(ギャラリー)。PU-2 アルバム一覧・PU-3 アルバム詳細・PU-4 写真ビューア(PF-5)
// /api/photos の下。LINE のログインが要る(requireLineUser)。販売が準備中なら requirePhotoSales が 503。
// 購入者は ensurePhotoCustomer(lib/photos/customers.ts)で決める。公開中・販売期間中のアルバムの、公開中の写真だけを返す。
export const galleryRoutes = new Hono<AppEnv>();

const todo = async (): Promise<never> => {
  throw notImplemented();
};

// 公開中のアルバム(galleryAlbumsQuerySchema → GalleryAlbumsResponse)
galleryRoutes.get('/albums', todo);
// アルバムの写真(→ GalleryAlbumDetail)。購入済みの印は entitlements(revoked_at IS NULL)から
galleryRoutes.get('/albums/:id', todo);
// 透かし付きのサムネイル・プレビュー(画像。photoThumbUrl・photoPreviewUrl)。画像を変換する口は作らない
galleryRoutes.get('/media/:albumId/:photoId/thumb', todo);
galleryRoutes.get('/media/:albumId/:photoId/preview', todo);
