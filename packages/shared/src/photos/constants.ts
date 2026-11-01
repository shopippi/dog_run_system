import { AUDIT_ACTION_LABELS } from '../api-types-households';
// 写真販売の決まった値と、画面に出す言葉(docs/photo-requirements.md)。

export const ALBUM_KINDS = ['date', 'event'] as const;
export type AlbumKind = (typeof ALBUM_KINDS)[number];
export const ALBUM_KIND_LABELS: Record<AlbumKind, string> = { date: '日付', event: 'イベント' };

export const ALBUM_STATUSES = ['draft', 'published', 'ended'] as const;
export type AlbumStatus = (typeof ALBUM_STATUSES)[number];
export const ALBUM_STATUS_LABELS: Record<AlbumStatus, string> = { draft: '下書き', published: '公開中', ended: '販売終了' };

export const ALBUM_PHOTO_STATUSES = ['draft', 'published', 'hidden', 'removed'] as const;
export type AlbumPhotoStatus = (typeof ALBUM_PHOTO_STATUSES)[number];
export const ALBUM_PHOTO_STATUS_LABELS: Record<AlbumPhotoStatus, string> = {
  draft: '下書き',
  published: '公開中',
  hidden: '非公開',
  removed: 'アルバムから外した',
};

export const ORDER_STATUSES = ['pending', 'paid', 'refunded', 'partially_refunded', 'expired', 'canceled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
/** 管理画面の言葉 */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'お支払い待ち',
  paid: 'お支払い済み',
  refunded: '返金済み',
  partially_refunded: '一部を返金',
  expired: 'お支払いされずに期限切れ',
  canceled: 'お客さんが取りやめ',
};
/** お客さんの言葉 */
export const ORDER_STATUS_LABELS_CUSTOMER: Record<OrderStatus, string> = {
  pending: 'お支払いの確認中',
  paid: '購入済み',
  refunded: '返金済み',
  partially_refunded: '一部を返金済み',
  expired: 'お支払いされませんでした',
  canceled: 'お支払いを取りやめました',
};

export const ORDER_ITEM_KINDS = ['photo', 'album'] as const;
export type OrderItemKind = (typeof ORDER_ITEM_KINDS)[number];

/** ブラウザで作り、原本と一緒に送る画像 */
export const PHOTO_DERIVATIVES = ['preview', 'thumb', 'view'] as const;
export type PhotoDerivative = (typeof PHOTO_DERIVATIVES)[number];
/** 長辺の大きさ(px)・JPEG の品質・透かし */
export const PHOTO_DERIVATIVE_SPECS: Record<PhotoDerivative, { longEdge: number; quality: number; watermark: boolean }> = {
  preview: { longEdge: 1200, quality: 0.7, watermark: true },
  thumb: { longEdge: 400, quality: 0.7, watermark: true },
  view: { longEdge: 2048, quality: 0.85, watermark: false },
};

/** 原本として受け付ける形式 */
export const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/heic', 'image/heif'] as const;
export type PhotoContentType = (typeof PHOTO_CONTENT_TYPES)[number];

/** 原本1枚の上限(バイト) */
export const PHOTO_ORIGINAL_MAX_BYTES = 200 * 1024 * 1024;
/** プレビューなど1枚の上限(バイト) */
export const PHOTO_DERIVATIVE_MAX_BYTES = 5 * 1024 * 1024;
/** R2 のマルチパートの1つの大きさ(最後以外は 5MiB 以上が必要) */
export const R2_PART_SIZE = 8 * 1024 * 1024;
/** 代わりの置き場所(データベース)のときの1つの大きさ。D1 の1行(2MB)に収める */
export const FALLBACK_PART_SIZE = 1024 * 1024 + 512 * 1024;
/** ダウンロードの URL の有効期限(秒) */
export const PHOTO_DOWNLOAD_TTL_SECONDS = 300;
/** ZIP にまとめられる枚数の上限 */
export const PHOTO_ZIP_MAX = 100;
/** カートに入れられる数の上限 */
export const PHOTO_CART_MAX = 200;
/** 同時に送る枚数(管理画面のアップロード) */
export const PHOTO_UPLOAD_CONCURRENCY = 4;

/** 写真販売の API のエラーの印(画面で分けて扱うもの) */
export const PHOTO_ERROR_CODES = {
  /** 販売が準備中(設定で止めている・置き場所や決済の設定がない) */
  unavailable: 'photo_sales_unavailable',
  /** 段階0の骨組みのまま(段階1で作る) */
  notImplemented: 'not_implemented',
  storageNotConfigured: 'photo_storage_not_configured',
  paymentsNotConfigured: 'payments_not_configured',
  /** ダウンロードの回数の上限 */
  downloadLimit: 'download_limit',
  notEntitled: 'not_entitled',
  /** 販売終了・非公開・見つからない写真がカートにある */
  itemUnavailable: 'item_unavailable',
  alreadyOwned: 'already_owned',
  refundNotEligible: 'refund_not_eligible',
  duplicatePhoto: 'duplicate_photo',
  hashMismatch: 'hash_mismatch',
  /** カートに買えるものがない(購入手続きのとき) */
  cartEmpty: 'cart_empty',
  /** 購入された写真は外せない(非公開だけ) */
  photoSold: 'photo_sold',
} as const;

/** 準備中のときの文(お客さん向け) */
export const PHOTO_UNAVAILABLE_MESSAGE = '写真の販売は準備中です。始まるまで、もうしばらくお待ちください。';
/** 写真の置き場所がないとき(管理画面・システムの状態) */
export const PHOTO_STORAGE_MISSING_MESSAGE =
  '写真の置き場所(R2)がまだ設定されていません。製作者に設定を依頼してください。設定が済むまで、写真の販売は始められません。';
/** Stripe の設定がないとき(管理画面) */
export const PHOTO_PAYMENTS_MISSING_MESSAGE =
  'お支払い(Stripe)の設定がまだです。施設の名義の Stripe アカウントを作り、製作者に設定を依頼してください。';
/** 段階0の骨組み */
export const PHOTO_NOT_IMPLEMENTED_MESSAGE = 'この操作は準備中です。できるようになるまで、もうしばらくお待ちください。';

// ---------------------------------------------------------------- URL(API と画面で同じものを使う)

/** お客さん向けの写真販売の API の頭 */
export const PHOTO_API = '/api/photos';
/** 透かし付きのサムネイル・プレビュー(LINE のログインつき。公開中のアルバムの写真だけ) */
export const photoThumbUrl = (albumId: number, photoId: number) => `${PHOTO_API}/media/${albumId}/${photoId}/thumb`;
export const photoPreviewUrl = (albumId: number, photoId: number) => `${PHOTO_API}/media/${albumId}/${photoId}/preview`;
/** 購入した写真の透かしなしの中サイズ(権利がある人だけ) */
export const purchasedViewUrl = (photoId: number) => `${PHOTO_API}/purchases/${photoId}/view`;
/** 管理画面の写真(ログインのクッキーで読むので <img src> に書ける) */
export const adminPhotoThumbUrl = (photoId: number) => `/admin/api/photos/photos/${photoId}/thumb`;
export const adminPhotoPreviewUrl = (photoId: number) => `/admin/api/photos/photos/${photoId}/preview`;

/** LIFF の画面のパス(/liff/ の下)。Stripe の success_url・cancel_url もここへ戻す */
export const PHOTO_LIFF_PATHS = {
  albums: '/photos',
  album: (albumId: number) => `/photos/albums/${albumId}`,
  viewer: (albumId: number, photoId: number) => `/photos/albums/${albumId}/photos/${photoId}`,
  cart: '/photos/cart',
  order: (orderId: number) => `/photos/orders/${orderId}`,
  purchases: '/photos/purchased',
  mockCheckout: (sessionId: string) => `/photos/mock-checkout/${sessionId}`,
  legal: '/photos/legal',
} as const;

/** Stripe から戻る URL(origin は https://<ドメイン>) */
export const photoSuccessUrl = (origin: string, orderId: number) => `${origin}/liff${PHOTO_LIFF_PATHS.order(orderId)}`;
export const photoCancelUrl = (origin: string) => `${origin}/liff${PHOTO_LIFF_PATHS.cart}`;

/** 代わりの置き場所(local・test・デモ)で、写真販売のファイルのキーの頭に付ける(犬の写真などと分ける) */
export const PHOTO_FALLBACK_PREFIX = 'photo-sales/';

// 操作ログ(A-15)の言葉(写真販売)
Object.assign(AUDIT_ACTION_LABELS, {
  'photo_album.sale_end': '写真の販売終了(自動)',
  'photo_album.files_delete': '売れなかった写真のファイルの削除(自動)',
});
