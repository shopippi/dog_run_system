import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { notImplemented } from '../../lib/photos/availability';

// 段階1-A(管理)。PA-3 アルバム一覧・PA-4 アルバム編集・PF-1 アルバム・PF-4 公開と一括操作
// 形は docs/photo-requirements.md 6.2 と packages/shared/src/photos/schemas.ts(変えるときは統合の担当へ)。
// /admin/api/photos の下。管理者だけ(受付スタッフは 403、製作者は見るだけ。photoAdminRoutes が確かめる)。
// 変更は audit_log に残す(target_type: 'photo_album' / 'photo')。物理削除しない(外す = album_photos.status = 'removed')。
export const adminAlbumRoutes = new Hono<AppEnv>();

const todo = async (): Promise<never> => {
  throw notImplemented();
};

// アルバムの一覧(albumListQuerySchema → AdminAlbumsResponse)
adminAlbumRoutes.get('/albums', todo);
// アルバムを作る(albumCreateSchema → { album: AdminAlbum })
adminAlbumRoutes.post('/albums', todo);
// フォルダ名からアルバムを作る(albumsFromFoldersSchema → AlbumsFromFoldersResponse)
adminAlbumRoutes.post('/albums/from-folders', todo);
// 一括公開(albumsBulkPublishSchema → BulkResult)
adminAlbumRoutes.post('/albums/publish', todo);
// アルバムの内容と写真(→ AdminAlbumDetail)
adminAlbumRoutes.get('/albums/:id', todo);
// アルバムの変更(albumUpdateSchema → AdminAlbumDetail)
adminAlbumRoutes.patch('/albums/:id', todo);
// 公開する(下書きの写真をまとめて公開。販売終了の日時の既定 = 公開 + photo_sale_months)(→ AdminAlbumDetail)
adminAlbumRoutes.post('/albums/:id/publish', todo);
// アルバムを一覧から外す・戻す(売れた写真があれば外せない)(→ { album: AdminAlbum })
adminAlbumRoutes.post('/albums/:id/remove', todo);
adminAlbumRoutes.post('/albums/:id/restore', todo);
// 写真の一括操作(albumPhotosBulkSchema → BulkResult)
adminAlbumRoutes.post('/albums/:id/photos/bulk', todo);
// 管理画面の写真(透かし付き。クッキーで読む)
adminAlbumRoutes.get('/photos/:photoId/thumb', todo);
adminAlbumRoutes.get('/photos/:photoId/preview', todo);
