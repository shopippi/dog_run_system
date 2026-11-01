import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { requirePhotoSales } from '../../lib/photos/availability';
import { requireRole } from '../../lib/staff-auth';
import { adminAlbumRoutes } from './admin-albums';
import { adminPhotoDashboardRoutes } from './admin-dashboard';
import { adminOrderRoutes } from './admin-orders';
import { adminPriceListRoutes } from './admin-price-lists';
import { adminUploadRoutes } from './admin-upload';
import { checkoutRoutes } from './checkout';
import { photoAvailabilityRoutes, photoConfigRoutes, photoFallbackUploadRoutes, photoFileRoutes, photoLegalRoutes } from './common';
import { deliveryPublicRoutes, deliveryRoutes } from './delivery';
import { galleryRoutes } from './gallery';
import { mockStripeRoutes } from './mock-stripe';
import { webhookRoutes } from './webhook';

// 写真販売の API のまとめ(docs/photo-requirements.md 6章。段階0・統合の担当のファイル)
// - photoPublicRoutes: /api/photos の下、認証なし(Webhook は署名、受け取り口は署名つきの短い期限の URL で守る)。
//   app.ts で、お客さん向け(LINE のログイン)より前に足す。use('*') を付けない(お客さん向けの道にもかかるため)
// - photoCustomerRoutes: /api/photos の下、LINE のログインつき(お客さん向けの部品の中に足す)。
//   /config だけは準備中でも答える。ほかは requirePhotoSales(準備中なら 503)
// - photoAdminRoutes: /admin/api/photos の下。管理者だけ(受付スタッフは見ることもできない = 403)。
//   製作者は見るだけ(変更は requireStaff が 403)

export const photoPublicRoutes = new Hono<AppEnv>();
photoPublicRoutes.route('/', webhookRoutes);
photoPublicRoutes.route('/', photoLegalRoutes);
photoPublicRoutes.route('/', deliveryPublicRoutes);
photoPublicRoutes.route('/', photoFileRoutes);

export const photoCustomerRoutes = new Hono<AppEnv>();
photoCustomerRoutes.route('/', photoConfigRoutes);
photoCustomerRoutes.use('*', requirePhotoSales);
photoCustomerRoutes.route('/', galleryRoutes);
photoCustomerRoutes.route('/', checkoutRoutes);
photoCustomerRoutes.route('/', deliveryRoutes);
photoCustomerRoutes.route('/', mockStripeRoutes);

export const photoAdminRoutes = new Hono<AppEnv>();
photoAdminRoutes.use('*', requireRole('admin'));
photoAdminRoutes.route('/', photoAvailabilityRoutes);
photoAdminRoutes.route('/', photoFallbackUploadRoutes);
photoAdminRoutes.route('/', adminAlbumRoutes);
photoAdminRoutes.route('/', adminUploadRoutes);
photoAdminRoutes.route('/', adminPriceListRoutes);
photoAdminRoutes.route('/', adminOrderRoutes);
photoAdminRoutes.route('/', adminPhotoDashboardRoutes);
