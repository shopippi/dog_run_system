import { galleryAlbumsQuerySchema } from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { requireStorage } from '../../lib/photos/availability';
import { ensurePhotoCustomer } from '../../lib/photos/customers';
import { parseInput } from '../../lib/validate';
import { galleryAlbumDetail, galleryEtag, galleryMediaKey, listGalleryAlbums, type GalleryMediaKind } from '../../services/photos/gallery';

// 段階1-B(ギャラリー)。PU-2 アルバム一覧・PU-3 アルバム詳細・PU-4 写真ビューア(PF-5)
// /api/photos の下。LINE のログインが要る(requireLineUser)。販売が準備中なら requirePhotoSales が 503。
// 購入者は ensurePhotoCustomer(lib/photos/customers.ts)で決める。公開中・販売期間中のアルバムの、公開中の写真だけを返す。
export const galleryRoutes = new Hono<AppEnv>();

const ALBUM_NOT_FOUND = 'このアルバムは見られなくなりました。販売が終わったか、お店が公開をやめた可能性があります。写真の一覧から選び直してください。';
const PHOTO_NOT_FOUND = '写真が見つかりませんでした。写真の一覧から選び直してください。';

/** URL の番号(正の整数)。それ以外は見つからない扱い */
function idParam(raw: string | undefined, message: string): number {
  if (!/^[1-9]\d{0,11}$/.test(raw ?? '')) throw errors.notFound(message);
  return Number(raw);
}

// 公開中のアルバム(galleryAlbumsQuerySchema → GalleryAlbumsResponse)
galleryRoutes.get('/albums', async (c) => {
  const q = parseInput(galleryAlbumsQuerySchema, c.req.query());
  return c.json(await listGalleryAlbums(c.env.DB, q, c.get('now')));
});

// アルバムの写真(→ GalleryAlbumDetail)。購入済みの印は entitlements(revoked_at IS NULL)から
galleryRoutes.get('/albums/:id', async (c) => {
  const albumId = idParam(c.req.param('id'), ALBUM_NOT_FOUND);
  const now = c.get('now');
  const customer = await ensurePhotoCustomer(c.env.DB, c.get('lineUser'), now);
  const detail = await galleryAlbumDetail(c.env.DB, albumId, customer.id, now);
  if (!detail) throw errors.notFound(ALBUM_NOT_FOUND);
  return c.json(detail);
});

// 透かし付きのサムネイル・プレビュー(画像。photoThumbUrl・photoPreviewUrl)。画像を変換する口は作らない
// (大きさ・透かしの有無を選ぶ口はない。アップロードのときにブラウザで作った2つだけを、そのまま返す)
for (const kind of ['thumb', 'preview'] as const satisfies readonly GalleryMediaKind[]) {
  galleryRoutes.get(`/media/:albumId/:photoId/${kind}`, async (c) => {
    const albumId = idParam(c.req.param('albumId'), PHOTO_NOT_FOUND);
    const photoId = idParam(c.req.param('photoId'), PHOTO_NOT_FOUND);
    const key = await galleryMediaKey(c.env.DB, albumId, photoId, kind, c.get('now'));
    if (!key) throw errors.notFound(PHOTO_NOT_FOUND);
    const etag = await galleryEtag(key);
    // その人のスマホの中だけに保存させる(private)。誰でも開ける URL にはしない(ログインが要る)
    const headers: Record<string, string> = {
      etag,
      'cache-control': 'private, max-age=86400',
      vary: 'Authorization',
      'x-content-type-options': 'nosniff',
    };
    const inm = c.req.header('if-none-match');
    if (inm && inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) return new Response(null, { status: 304, headers });
    const file = await requireStorage(c).get(key);
    if (!file) throw errors.notFound(PHOTO_NOT_FOUND);
    return new Response(file.body, {
      headers: { ...headers, 'content-type': 'image/jpeg', 'content-length': String(file.size) },
    });
  });
}
