import {
  albumCreateSchema,
  albumListQuerySchema,
  albumPhotosBulkSchema,
  albumsBulkPublishSchema,
  albumsFromFoldersSchema,
  albumUpdateSchema,
  type AdminAlbumsResponse,
} from '@dr/shared';
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { requireStorage } from '../../lib/photos/availability';
import { loadSettings } from '../../lib/settings';
import { parseInput, parseJson } from '../../lib/validate';
import {
  albumDetail,
  albumsFromFolders,
  createAlbum,
  publishAlbum,
  publishAlbums,
  removeAlbum,
  restoreAlbum,
  updateAlbum,
} from '../../services/photos/admin-albums';
import { bulkAlbumPhotos } from '../../services/photos/admin-bulk';
import { albumStats, listAlbumStats, toId } from '../../services/photos/admin-common';

// 段階1-A(管理)。PA-3 アルバム一覧・PA-4 アルバム編集・PF-1 アルバム・PF-4 公開と一括操作
// 形は docs/photo-requirements.md 6.2 と packages/shared/src/photos/schemas.ts(変えるときは統合の担当へ)。
// /admin/api/photos の下。管理者だけ(受付スタッフは 403、製作者は見るだけ。photoAdminRoutes が確かめる)。
// 変更は audit_log に残す(target_type: 'photo_album' / 'photo')。物理削除しない(外す = album_photos.status = 'removed')。
// 応答の形は凍結したもののまま(項目を足さない)。トーストの「元に戻す」は BulkResult の auditId だけ。ほかは操作ログの画面から戻せる。
export const adminAlbumRoutes = new Hono<AppEnv>();

const ctxOf = (c: Context<AppEnv>) => ({ staffId: c.get('staff').id, now: c.get('now') });

// アルバムの一覧(albumListQuerySchema → AdminAlbumsResponse)
adminAlbumRoutes.get('/albums', async (c) => {
  const q = parseInput(albumListQuerySchema, {
    status: c.req.query('status') || undefined,
    kind: c.req.query('kind') || undefined,
    q: c.req.query('q') || undefined,
  });
  const body: AdminAlbumsResponse = {
    albums: (await listAlbumStats(c.env.DB, q)).map(({ unitPrice: _u, albumPrice: _a, sourceFolder: _s, ...a }) => a),
  };
  return c.json(body);
});

// アルバムを作る(albumCreateSchema → { album: AdminAlbum })
adminAlbumRoutes.post('/albums', async (c) => {
  const input = await parseJson(c, albumCreateSchema);
  const { album } = await createAlbum(c.env.DB, input, ctxOf(c));
  return c.json({ album }, 201);
});

// フォルダ名からアルバムを作る(albumsFromFoldersSchema → AlbumsFromFoldersResponse)
adminAlbumRoutes.post('/albums/from-folders', async (c) => {
  const input = await parseJson(c, albumsFromFoldersSchema);
  return c.json(await albumsFromFolders(c.env.DB, input.folders, ctxOf(c)));
});

// 一括公開(albumsBulkPublishSchema → BulkResult。skipped の photoId の欄はアルバムの番号)
adminAlbumRoutes.post('/albums/publish', async (c) => {
  const input = await parseJson(c, albumsBulkPublishSchema);
  const settings = await loadSettings(c.env.DB);
  return c.json(await publishAlbums(c.env.DB, input.albumIds, ctxOf(c), settings.photo_sale_months));
});

// アルバムの内容と写真(→ AdminAlbumDetail)
adminAlbumRoutes.get('/albums/:id', async (c) => {
  const id = toId(c.req.param('id'));
  if (!id) throw errors.notFound('アルバムが見つかりませんでした。アルバムの一覧から選び直してください。');
  return c.json(await albumDetail(c.env.DB, id));
});

// アルバムの変更(albumUpdateSchema → AdminAlbumDetail)
adminAlbumRoutes.patch('/albums/:id', async (c) => {
  const input = await parseJson(c, albumUpdateSchema);
  const { detail } = await updateAlbum(c.env.DB, toId(c.req.param('id')), input, ctxOf(c));
  return c.json(detail);
});

// 公開する(下書きの写真をまとめて公開。販売終了の日時の既定 = 公開 + photo_sale_months)(→ AdminAlbumDetail)
adminAlbumRoutes.post('/albums/:id/publish', async (c) => {
  const settings = await loadSettings(c.env.DB);
  const { detail } = await publishAlbum(c.env.DB, toId(c.req.param('id')), ctxOf(c), settings.photo_sale_months);
  return c.json(detail);
});

// アルバムを一覧から外す・戻す(売れた写真があれば外せない)(→ { album: AdminAlbum })
adminAlbumRoutes.post('/albums/:id/remove', async (c) => {
  const id = toId(c.req.param('id'));
  await removeAlbum(c.env.DB, id, ctxOf(c));
  const { removedAt: _r, unitPrice: _u, albumPrice: _a, sourceFolder: _s, ...album } = await albumStats(c.env.DB, id);
  return c.json({ album });
});
adminAlbumRoutes.post('/albums/:id/restore', async (c) => {
  const id = toId(c.req.param('id'));
  await restoreAlbum(c.env.DB, id, ctxOf(c));
  const { removedAt: _r, unitPrice: _u, albumPrice: _a, sourceFolder: _s, ...album } = await albumStats(c.env.DB, id);
  return c.json({ album });
});

// 写真の一括操作(albumPhotosBulkSchema → BulkResult)
adminAlbumRoutes.post('/albums/:id/photos/bulk', async (c) => {
  const input = await parseJson(c, albumPhotosBulkSchema);
  return c.json(await bulkAlbumPhotos(c.env.DB, toId(c.req.param('id')), input, ctxOf(c)));
});

// 管理画面の写真(透かし付き。クッキーで読む)。大きさや透かしを選ぶ口は作らない(アップロードのときに作ったものを返すだけ)
async function servePhoto(c: Context<AppEnv>, kind: 'thumb' | 'preview') {
  const id = toId(c.req.param('photoId'));
  const notFound = () => errors.notFound('写真が見つかりませんでした。画面を読み込み直してください。');
  if (!id) throw notFound();
  const row = await c.env.DB.prepare(`SELECT ${kind}_key AS k, files_deleted_at FROM photos WHERE id = ?`)
    .bind(id)
    .first<{ k: string | null; files_deleted_at: string | null }>();
  if (!row?.k || row.files_deleted_at) throw notFound();
  const file = await requireStorage(c).get(row.k);
  if (!file) throw notFound();
  return new Response(file.body, {
    headers: {
      'content-type': 'image/jpeg',
      'content-length': String(file.size),
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
    },
  });
}
adminAlbumRoutes.get('/photos/:photoId/thumb', (c) => servePhoto(c, 'thumb'));
adminAlbumRoutes.get('/photos/:photoId/preview', (c) => servePhoto(c, 'preview'));
