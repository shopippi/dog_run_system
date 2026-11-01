import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { notImplemented } from '../../lib/photos/availability';

// 段階1-D(配信)。PU-7 購入した写真(PF-7)
// ダウンロードできるかは entitlements(revoked_at IS NULL)だけで決める。押すたびに5分の URL(storage.downloadUrl)。
// 回数の上限は downloadAllowance(写真1枚につき photo_download_limit)。download_logs に残す(IP はハッシュ)。
// 購入した写真は、販売終了のあとも見られる(purchased_key のファイルは消さない)。
export const deliveryRoutes = new Hono<AppEnv>();

const todo = async (): Promise<never> => {
  throw notImplemented();
};

// 購入した写真(アルバム別)(→ PurchasesResponse)
deliveryRoutes.get('/purchases', todo);
// 透かしなしの中サイズ(画像。purchasedViewUrl)
deliveryRoutes.get('/purchases/:photoId/view', todo);
// 原本のダウンロードの URL(→ DownloadResponse)。上限なら 429 download_limit
deliveryRoutes.post('/purchases/:photoId/download', todo);
// 複数枚を ZIP で(zipRequestSchema → DownloadResponse)。無圧縮で結合する
deliveryRoutes.post('/purchases/zip', todo);

/** 認証なし(署名で守る): ZIP の受け取り口。/api/photos/files/zip/:token */
export const deliveryPublicRoutes = new Hono<AppEnv>();
deliveryPublicRoutes.get('/files/zip/:token', todo);
