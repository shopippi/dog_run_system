import { zipRequestSchema } from '@dr/shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { originOf, requireStorage } from '../../lib/photos/availability';
import { ensurePhotoCustomer } from '../../lib/photos/customers';
import { loadSettings } from '../../lib/settings';
import { parseJson } from '../../lib/validate';
import { ipHashOf, issueDownload, issueZip, listPurchases, streamZip, viewImage, type DownloadContext } from '../../services/photos/delivery';

// 段階1-D(配信)。PU-7 購入した写真(PF-7)
// ダウンロードできるかは entitlements(revoked_at IS NULL)だけで決める。押すたびに5分の URL(storage.downloadUrl)。
// 回数の上限は downloadAllowance(写真1枚につき photo_download_limit)。download_logs に残す(IP はハッシュ)。
// 購入した写真は、販売終了のあとも見られる(purchased_key のファイルは消さない)。
export const deliveryRoutes = new Hono<AppEnv>();

function photoIdOf(c: Context<AppEnv>): number {
  const id = Number(c.req.param('photoId'));
  if (!Number.isInteger(id) || id <= 0) throw errors.notFound('写真が見つかりませんでした。購入した写真の画面を読み込み直してください。');
  return id;
}

async function downloadContext(c: Context<AppEnv>): Promise<{ ctx: DownloadContext; facilityName: string }> {
  const now = c.get('now');
  const storage = requireStorage(c);
  const [customer, settings] = await Promise.all([ensurePhotoCustomer(c.env.DB, c.get('lineUser'), now), loadSettings(c.env.DB)]);
  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-real-ip') ?? null;
  return {
    facilityName: settings.facility_name,
    ctx: {
      db: c.env.DB,
      env: c.env,
      storage,
      customerId: customer.id,
      now,
      origin: originOf(c),
      limit: settings.photo_download_limit,
      ipHash: await ipHashOf(c.env, ip),
      userAgent: c.req.header('user-agent')?.slice(0, 300) ?? null,
    },
  };
}

// 購入した写真(アルバム別)(→ PurchasesResponse)
deliveryRoutes.get('/purchases', async (c) => {
  const now = c.get('now');
  const [customer, settings] = await Promise.all([ensurePhotoCustomer(c.env.DB, c.get('lineUser'), now), loadSettings(c.env.DB)]);
  return c.json(await listPurchases(c.env.DB, customer.id, now, settings.photo_download_limit));
});

// 透かしなしの中サイズ(画像。purchasedViewUrl)
deliveryRoutes.get('/purchases/:photoId/view', async (c) => {
  const photoId = photoIdOf(c);
  const storage = requireStorage(c);
  const customer = await ensurePhotoCustomer(c.env.DB, c.get('lineUser'), c.get('now'));
  return viewImage(c.env.DB, storage, customer.id, photoId);
});

// 原本のダウンロードの URL(→ DownloadResponse)。上限なら 429 download_limit
deliveryRoutes.post('/purchases/:photoId/download', async (c) => {
  const photoId = photoIdOf(c);
  const { ctx } = await downloadContext(c);
  return c.json(await issueDownload(ctx, photoId));
});

// 複数枚を ZIP で(zipRequestSchema → DownloadResponse)。無圧縮で結合する
deliveryRoutes.post('/purchases/zip', async (c) => {
  const input = await parseJson(c, zipRequestSchema);
  const { ctx, facilityName } = await downloadContext(c);
  return c.json(await issueZip(ctx, input.photoIds, facilityName));
});

/** 認証なし(署名で守る): ZIP の受け取り口。/api/photos/files/zip/:token */
export const deliveryPublicRoutes = new Hono<AppEnv>();
deliveryPublicRoutes.get('/files/zip/:token', async (c) => {
  const storage = requireStorage(c);
  return streamZip(c.env, storage, c.req.param('token'), c.get('now'));
});
