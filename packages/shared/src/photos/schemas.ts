import { z } from 'zod';
import {
  ALBUM_KINDS,
  ALBUM_PHOTO_STATUSES,
  ALBUM_STATUSES,
  ORDER_STATUSES,
  PHOTO_CART_MAX,
  PHOTO_CONTENT_TYPES,
  PHOTO_DERIVATIVES,
  PHOTO_DERIVATIVE_MAX_BYTES,
  PHOTO_ORIGINAL_MAX_BYTES,
  PHOTO_ZIP_MAX,
} from './constants';

// 写真販売の API の入力と応答の形(docs/photo-requirements.md 6章)。
// 段階0で凍結する。形を変えるときは、統合の担当(段階0)に戻す(docs/photo-stage1-brief.md)。

// ================================================================ 部品

const DATE_MESSAGE = '日にちを選び直してください。';
export const photoYmdSchema = z
  .string({ error: DATE_MESSAGE })
  .regex(/^(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, { error: DATE_MESSAGE })
  .refine((d) => new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d, { error: DATE_MESSAGE });
/** 日本時間の日時("2026-11-03T09:00:00+09:00") */
export const jstIsoSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?\+09:00$/, { error: '日時の形が正しくありません。選び直してください。' });
const idSchema = z.number().int().positive();
const idListSchema = (max: number, what: string) =>
  z
    .array(idSchema, { error: `${what}を選んでください。` })
    .min(1, { error: `${what}を1つ以上選んでください。` })
    .max(max, { error: `一度に選べるのは${max}件までです。分けて操作してください。` })
    .transform((xs) => [...new Set(xs)]);
export const albumKindSchema = z.enum(ALBUM_KINDS, { error: '「日付」か「イベント」を選んでください。' });
const yenSchema = (what: string) =>
  z
    .number({ error: `${what}を数字で入れてください。` })
    .int({ error: `${what}は1円単位で入れてください。` })
    .min(50, { error: `${what}は50円以上にしてください(カード払いの最低の金額です)。` })
    .max(1_000_000, { error: `${what}が大きすぎます。入れ直してください。` });
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/i, { error: '写真の確認用の値が正しくありません。もう一度送ってください。' });
const albumNameSchema = z
  .string({ error: 'アルバムの名前を入れてください。' })
  .trim()
  .min(1, { error: 'アルバムの名前を入れてください。' })
  .max(60, { error: 'アルバムの名前は60文字までにしてください。' });

// ================================================================ 管理画面: アルバム(PA-2〜PA-4)

export const albumCreateSchema = z.object({
  name: albumNameSchema,
  kind: albumKindSchema,
  eventDate: photoYmdSchema,
  /** 省くと、種類ごとの既定の価格表 */
  priceListId: idSchema.optional(),
});
export type AlbumCreateInput = z.infer<typeof albumCreateSchema>;

/** フォルダを落としたとき。フォルダ名からアルバムを作る(同じ名前の下書きがあればそれを使う) */
export const albumsFromFoldersSchema = z.object({
  folders: z
    .array(z.string().trim().min(1).max(200), { error: 'フォルダを選んでください。' })
    .min(1, { error: 'フォルダを1つ以上落としてください。' })
    .max(50, { error: '一度に落とせるフォルダは50個までです。分けて落としてください。' }),
});
export type AlbumsFromFoldersInput = z.infer<typeof albumsFromFoldersSchema>;

export const albumUpdateSchema = z
  .object({
    name: albumNameSchema,
    kind: albumKindSchema,
    eventDate: photoYmdSchema,
    priceListId: idSchema,
    /** 販売終了の日時(延長・短縮)。公開前は null(公開したときに既定の値が入る) */
    saleEndsAt: jstIsoSchema.nullable(),
    coverPhotoId: idSchema.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: '変える項目がありません。' });
export type AlbumUpdateInput = z.infer<typeof albumUpdateSchema>;

export const albumListQuerySchema = z.object({
  status: z.enum(ALBUM_STATUSES).optional(),
  kind: albumKindSchema.optional(),
  q: z.string().trim().max(60).optional(),
});

export const albumsBulkPublishSchema = z.object({ albumIds: idListSchema(100, 'アルバム') });

/** アルバムの写真の一括操作(PF-4)。photoIds はそのアルバムに載っている写真 */
export const albumPhotosBulkSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set_price'), photoIds: idListSchema(1000, '写真'), price: yenSchema('価格') }),
  z.object({ action: z.literal('reset_price'), photoIds: idListSchema(1000, '写真') }),
  z.object({ action: z.literal('publish'), photoIds: idListSchema(1000, '写真') }),
  z.object({ action: z.literal('hide'), photoIds: idListSchema(1000, '写真') }),
  /** アルバムから外す(売れた写真は外せない。非公開にする) */
  z.object({ action: z.literal('remove'), photoIds: idListSchema(1000, '写真') }),
  z.object({ action: z.literal('move'), photoIds: idListSchema(1000, '写真'), targetAlbumId: idSchema }),
  z.object({ action: z.literal('copy'), photoIds: idListSchema(1000, '写真'), targetAlbumId: idSchema }),
  /** 並び順(アルバムの全部の写真を、新しい順に) */
  z.object({ action: z.literal('reorder'), photoIds: idListSchema(5000, '写真') }),
]);
export type AlbumPhotosBulkInput = z.infer<typeof albumPhotosBulkSchema>;

// ================================================================ 管理画面: アップロード(PF-2)

export const uploadStartSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  bytes: z.number().int().positive().max(PHOTO_ORIGINAL_MAX_BYTES, { error: '写真が大きすぎます(200MB まで)。' }),
  contentType: z.enum(PHOTO_CONTENT_TYPES, { error: 'JPEG か HEIC の写真だけを送れます。' }),
  /** ブラウザで計算した原本の SHA-256 */
  sha256: sha256Schema,
  width: z.number().int().positive().max(100_000).nullable().optional(),
  height: z.number().int().positive().max(100_000).nullable().optional(),
  takenAt: jstIsoSchema.nullable().optional(),
});
export type UploadStartInput = z.infer<typeof uploadStartSchema>;

export const uploadPartsSchema = z.object({
  partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(100),
});

export const uploadCompleteSchema = z.object({
  parts: z
    .array(z.object({ partNumber: z.number().int().min(1).max(10_000), etag: z.string().min(1).max(200) }))
    .min(1)
    .max(10_000),
});

export const derivativeKindSchema = z.enum(PHOTO_DERIVATIVES);
export const uploadDerivativeSchema = z.object({
  kind: derivativeKindSchema,
  bytes: z.number().int().positive().max(PHOTO_DERIVATIVE_MAX_BYTES),
  contentType: z.literal('image/jpeg'),
});

// ================================================================ 管理画面: 価格表(PF-3・PA-5)

export const priceListCreateSchema = z.object({
  name: z.string().trim().min(1, { error: '価格表の名前を入れてください。' }).max(30, { error: '価格表の名前は30文字までにしてください。' }),
  unitPrice: yenSchema('1枚の価格'),
  albumPrice: yenSchema('アルバムまるごとの価格').max(10_000_000).nullable(),
});
export const priceListUpdateSchema = priceListCreateSchema
  .extend({ status: z.enum(['active', 'archived']) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: '変える項目がありません。' });
export const priceListDefaultsSchema = z.object({ date: idSchema, event: idSchema });

// ================================================================ 管理画面: 注文と返金(PA-6)

export const adminOrdersQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  /** 注文の番号・LINE の表示名 */
  q: z.string().trim().max(60).optional(),
  from: photoYmdSchema.optional(),
  to: photoYmdSchema.optional(),
  /** これより前の注文(番号) */
  before: z.coerce.number().int().positive().optional(),
});

export const refundSchema = z
  .object({
    itemIds: idListSchema(500, '返金する明細'),
    reason: z.string().trim().min(1, { error: '返金の理由を入れてください。' }).max(500, { error: '理由は500文字までにしてください。' }),
    /** 7日・未ダウンロードの条件の外で返金する(管理者だけ。理由は操作ログに残る) */
    override: z.boolean().default(false),
  });
export type RefundInput = z.infer<typeof refundSchema>;

// ================================================================ お客さん: ギャラリー・カート・ダウンロード(PU-2〜PU-7)

export const galleryAlbumsQuerySchema = z.object({
  kind: albumKindSchema.optional(),
  /** 開催月("2026-11") */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
});

export const cartItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('photo'), albumId: idSchema, photoId: idSchema }),
  z.object({ kind: z.literal('album'), albumId: idSchema }),
]);
export type CartItem = z.infer<typeof cartItemSchema>;
/** カートに入れる(複数をまとめて。グリッドで選んで「カートに入れる」)。同じものはまとめて1つ */
export const cartAddSchema = z.object({
  items: z.array(cartItemSchema).min(1, { error: '写真を選んでください。' }).max(PHOTO_CART_MAX, { error: `一度に入れられるのは${PHOTO_CART_MAX}件までです。` }),
});
export type CartAddInput = z.infer<typeof cartAddSchema>;
/** 購入手続き。中身はサーバーのカート(金額・品物は送らない。サーバーが DB から計算する) */
export const checkoutSchema = z.object({});

export const zipRequestSchema = z.object({ photoIds: idListSchema(PHOTO_ZIP_MAX, '写真') });

// ================================================================ 応答の形

export const priceListSchema = z.object({
  id: idSchema,
  name: z.string(),
  unitPrice: z.number().int(),
  albumPrice: z.number().int().nullable(),
  isDefaultFor: albumKindSchema.nullable(),
  status: z.enum(['active', 'archived']),
  /** 使っているアルバムの数 */
  albumCount: z.number().int(),
});
export type PriceList = z.infer<typeof priceListSchema>;
export const priceListsResponseSchema = z.object({ priceLists: z.array(priceListSchema) });
export type PriceListsResponse = z.infer<typeof priceListsResponseSchema>;

export const adminAlbumSchema = z.object({
  id: idSchema,
  name: z.string(),
  kind: albumKindSchema,
  eventDate: z.string(),
  status: z.enum(ALBUM_STATUSES),
  priceListId: idSchema,
  priceListName: z.string(),
  publishedAt: z.string().nullable(),
  saleEndsAt: z.string().nullable(),
  coverThumbUrl: z.string().nullable(),
  /** 枚数(状態ごと) */
  counts: z.object({ draft: z.number().int(), published: z.number().int(), hidden: z.number().int() }),
  /** 売上(円。返金を引いた額)と売れた枚数 */
  salesYen: z.number().int(),
  soldPhotos: z.number().int(),
  filesDeletedAt: z.string().nullable(),
});
export type AdminAlbum = z.infer<typeof adminAlbumSchema>;
export const adminAlbumsResponseSchema = z.object({ albums: z.array(adminAlbumSchema) });
export type AdminAlbumsResponse = z.infer<typeof adminAlbumsResponseSchema>;

export const adminAlbumPhotoSchema = z.object({
  photoId: idSchema,
  filename: z.string(),
  status: z.enum(ALBUM_PHOTO_STATUSES),
  sortOrder: z.number().int(),
  priceOverride: z.number().int().nullable(),
  /** 実際の価格(例外価格 > 価格表) */
  price: z.number().int(),
  thumbUrl: z.string().nullable(),
  previewUrl: z.string().nullable(),
  sold: z.boolean(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  bytes: z.number().int(),
  /** ほかのアルバムにも載っているか(アルバムの名前) */
  alsoIn: z.array(z.object({ albumId: idSchema, name: z.string() })),
});
export type AdminAlbumPhoto = z.infer<typeof adminAlbumPhotoSchema>;
export const adminAlbumDetailSchema = z.object({
  album: adminAlbumSchema.extend({ albumPrice: z.number().int().nullable(), unitPrice: z.number().int(), sourceFolder: z.string().nullable() }),
  photos: z.array(adminAlbumPhotoSchema),
});
export type AdminAlbumDetail = z.infer<typeof adminAlbumDetailSchema>;

export const albumsFromFoldersResponseSchema = z.object({
  albums: z.array(z.object({ folder: z.string(), albumId: idSchema, name: z.string(), kind: albumKindSchema, eventDate: z.string(), created: z.boolean() })),
});
export type AlbumsFromFoldersResponse = z.infer<typeof albumsFromFoldersResponseSchema>;

export const bulkResultSchema = z.object({
  changed: z.number().int(),
  /** できなかった写真と理由(売れた写真は外せない、など) */
  skipped: z.array(z.object({ photoId: idSchema, reason: z.string() })),
  /** トーストの「元に戻す」に使う操作ログの番号 */
  auditId: z.number().int().nullable(),
});
export type BulkResult = z.infer<typeof bulkResultSchema>;

/** 送り先。R2 のときは R2 の署名つき URL、代わりの置き場所のときは Worker の URL(x-dr-admin などのヘッダーを付けて送る) */
export const uploadTargetSchema = z.object({
  url: z.string(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string(),
});
export type UploadTarget = z.infer<typeof uploadTargetSchema>;

export const uploadStartResponseSchema = z.discriminatedUnion('duplicate', [
  z.object({ duplicate: z.literal(true), photoId: idSchema }),
  z.object({
    duplicate: z.literal(false),
    photoId: idSchema,
    uploadId: z.string(),
    storage: z.enum(['r2', 'fallback']),
    partSize: z.number().int(),
    partCount: z.number().int(),
  }),
]);
export type UploadStartResponse = z.infer<typeof uploadStartResponseSchema>;
export const uploadPartsResponseSchema = z.object({
  parts: z.array(uploadTargetSchema.extend({ partNumber: z.number().int() })),
});
export const uploadStatusResponseSchema = z.object({
  uploadId: z.string(),
  status: z.enum(['uploading', 'completed', 'aborted', 'failed']),
  /** 送り終えた部分(続きから送るため) */
  parts: z.array(z.object({ partNumber: z.number().int(), etag: z.string(), size: z.number().int() })),
  derivatives: z.array(derivativeKindSchema),
});
export const uploadCompleteResponseSchema = z.object({
  photoId: idSchema,
  /** サーバーで確かめた SHA-256 が、ブラウザの値と一致したか */
  verified: z.boolean(),
});

export const adminOrderSummarySchema = z.object({
  id: idSchema,
  status: z.enum(ORDER_STATUSES),
  amount: z.number().int(),
  refundedAmount: z.number().int(),
  paidAt: z.string().nullable(),
  createdAt: z.string(),
  customerName: z.string().nullable(),
  /** 会員なら会員ID */
  memberNo: z.string().nullable(),
  itemCount: z.number().int(),
  paymentMode: z.enum(['live', 'mock']),
});
export type AdminOrderSummary = z.infer<typeof adminOrderSummarySchema>;
export const adminOrdersResponseSchema = z.object({ orders: z.array(adminOrderSummarySchema), nextBefore: z.number().int().nullable() });
export type AdminOrdersResponse = z.infer<typeof adminOrdersResponseSchema>;

export const adminOrderDetailSchema = z.object({
  order: adminOrderSummarySchema.extend({ householdId: z.number().int().nullable(), stripeSessionId: z.string().nullable() }),
  items: z.array(
    z.object({
      id: idSchema,
      kind: z.enum(['photo', 'album']),
      albumId: idSchema,
      albumName: z.string(),
      photoId: idSchema.nullable(),
      label: z.string(),
      unitPrice: z.number().int(),
      thumbUrl: z.string().nullable(),
      refundedAt: z.string().nullable(),
      refundAmount: z.number().int().nullable(),
      refundReason: z.string().nullable(),
      /** 返金の条件(7日・未ダウンロード)を満たすか。満たさなければ理由 */
      refund: z.object({ eligible: z.boolean(), reason: z.string().nullable(), deadline: z.string().nullable() }),
      downloads: z.number().int(),
    }),
  ),
  downloads: z.array(z.object({ photoId: idSchema, kind: z.enum(['original', 'zip']), createdAt: z.string(), userAgent: z.string().nullable() })),
});
export type AdminOrderDetail = z.infer<typeof adminOrderDetailSchema>;
export const refundResponseSchema = z.object({ order: adminOrderSummarySchema, refundedItemIds: z.array(idSchema), auditId: z.number().int().nullable() });
export type RefundResponse = z.infer<typeof refundResponseSchema>;

/** 写真販売が使えるか(管理画面の写真販売の上・設定・システムの状態に出す) */
export const photoAvailabilitySchema = z.object({
  /** お客さんに見せているか(設定・置き場所・決済のすべてがそろっている) */
  available: z.boolean(),
  enabledSetting: z.boolean(),
  storage: z.enum(['r2', 'fallback', 'missing']),
  payments: z.enum(['live', 'mock', 'missing']),
  /** 使えないときの理由(画面にそのまま出す)。使えるときは null */
  message: z.string().nullable(),
});
export type PhotoAvailability = z.infer<typeof photoAvailabilitySchema>;

export const photoDashboardResponseSchema = z.object({
  month: z.string(),
  salesYen: z.number().int(),
  soldPhotos: z.number().int(),
  orders: z.number().int(),
  endingSoon: z.array(z.object({ albumId: idSchema, name: z.string(), saleEndsAt: z.string(), unsoldPhotos: z.number().int() })),
  recentOrders: z.array(adminOrderSummarySchema),
  /** 置き場所・決済・設定の状態(準備中の理由を画面に出す) */
  availability: photoAvailabilitySchema,
});
export type PhotoDashboardResponse = z.infer<typeof photoDashboardResponseSchema>;


// ---------------------------------------------------------------- お客さん

export const photoConfigResponseSchema = z.object({
  available: z.boolean(),
  /** 準備中のときの文 */
  message: z.string().nullable(),
  facilityName: z.string(),
  refundDays: z.number().int(),
  downloadLimit: z.object({ count: z.number().int(), hours: z.number().int() }),
});
export type PhotoConfigResponse = z.infer<typeof photoConfigResponseSchema>;

export const galleryAlbumSchema = z.object({
  id: idSchema,
  name: z.string(),
  kind: albumKindSchema,
  eventDate: z.string(),
  saleEndsAt: z.string().nullable(),
  photoCount: z.number().int(),
  coverThumbUrl: z.string().nullable(),
  unitPrice: z.number().int(),
  albumPrice: z.number().int().nullable(),
});
export type GalleryAlbum = z.infer<typeof galleryAlbumSchema>;
export const galleryAlbumsResponseSchema = z.object({
  albums: z.array(galleryAlbumSchema),
  /** 年月の絞り込みに出す月("2026-11"。新しい順) */
  months: z.array(z.string()),
});
export type GalleryAlbumsResponse = z.infer<typeof galleryAlbumsResponseSchema>;

export const galleryPhotoSchema = z.object({
  photoId: idSchema,
  price: z.number().int(),
  thumbUrl: z.string(),
  previewUrl: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  /** 購入済み(カートに入れられない) */
  purchased: z.boolean(),
});
export type GalleryPhoto = z.infer<typeof galleryPhotoSchema>;
export const galleryAlbumDetailSchema = z.object({
  album: galleryAlbumSchema,
  photos: z.array(galleryPhotoSchema),
  /** まるごと購入できるか(価格表にあり、まだ全部は持っていない) */
  canBuyAlbum: z.boolean(),
});
export type GalleryAlbumDetail = z.infer<typeof galleryAlbumDetailSchema>;

export const cartLineSchema = z.object({
  kind: z.enum(['photo', 'album']),
  albumId: idSchema,
  photoId: idSchema.nullable(),
  albumName: z.string(),
  label: z.string(),
  unitPrice: z.number().int(),
  thumbUrl: z.string().nullable(),
  /** まるごとのときの枚数 */
  photoCount: z.number().int().nullable(),
});
export type CartLineView = z.infer<typeof cartLineSchema>;

/** カートの1行。state: ok = 購入手続きに入る / redundant = 同じカートのまるごとに含まれる(請求しない) / unavailable = 買えない(除く) */
export const cartItemViewSchema = cartLineSchema.extend({
  id: idSchema,
  state: z.enum(['ok', 'redundant', 'unavailable']),
  reason: z.enum(['ended', 'hidden', 'not_found', 'already_owned', 'no_album_price', 'in_album']).nullable(),
  /** 印の横に出す一言(「アルバムまるごとに含まれています」「販売が終わりました」など) */
  message: z.string().nullable(),
  addedAt: z.string(),
});
export type CartItemView = z.infer<typeof cartItemViewSchema>;
export const cartResponseSchema = z.object({
  items: z.array(cartItemViewSchema),
  /** 合計(state = ok の行だけ。税込み・円。サーバーが計算) */
  total: z.number().int(),
  /** 購入手続きに入る数(state = ok) */
  payableCount: z.number().int(),
});
export type CartResponse = z.infer<typeof cartResponseSchema>;
/** カートに入れた結果(入れたあとのカートと、入れなかったもの) */
export const cartAddResponseSchema = cartResponseSchema.extend({
  added: z.number().int(),
  /** もう入っていた・買えない・購入済みなどで入れなかったもの */
  skipped: z.array(z.object({ item: cartItemSchema, reason: z.enum(['already_in_cart', 'ended', 'hidden', 'not_found', 'already_owned', 'no_album_price']), message: z.string() })),
});
export type CartAddResponse = z.infer<typeof cartAddResponseSchema>;

export const checkoutResponseSchema = z.object({
  orderId: idSchema,
  /** Stripe Checkout(本番)か、まねの支払いの画面(local・test)の URL。画面はここへ移る。1つの Checkout に、カートの ok の行がすべて明細として入る */
  checkoutUrl: z.string(),
  amount: z.number().int(),
  /** 買えなくなって除いたカートの行・まるごとに含まれていて請求しなかった行(画面は知らせる) */
  excludedItemIds: z.array(idSchema),
});
export type CheckoutResponse = z.infer<typeof checkoutResponseSchema>;

export const myOrderSchema = z.object({
  id: idSchema,
  status: z.enum(ORDER_STATUSES),
  amount: z.number().int(),
  createdAt: z.string(),
  paidAt: z.string().nullable(),
  lines: z.array(cartLineSchema),
});
export type MyOrder = z.infer<typeof myOrderSchema>;
export const myOrdersResponseSchema = z.object({ orders: z.array(myOrderSchema) });

export const purchasedPhotoSchema = z.object({
  photoId: idSchema,
  filename: z.string(),
  /** 透かしなしの中サイズ(長辺2048px)。認証つきの API */
  viewUrl: z.string().nullable(),
  /** 直近の時間でのダウンロードの残り */
  downloadsRemaining: z.number().int(),
  purchasedAt: z.string(),
});
export type PurchasedPhoto = z.infer<typeof purchasedPhotoSchema>;
export const purchasesResponseSchema = z.object({
  albums: z.array(z.object({ albumId: idSchema, name: z.string(), eventDate: z.string(), photos: z.array(purchasedPhotoSchema) })),
});
export type PurchasesResponse = z.infer<typeof purchasesResponseSchema>;

/** 原本・ZIP のダウンロード。押すたびに新しい URL(5分) */
export const downloadResponseSchema = z.object({ url: z.string(), expiresAt: z.string(), filename: z.string() });
export type DownloadResponse = z.infer<typeof downloadResponseSchema>;

/** 特定商取引法に基づく表記・利用規約・プライバシーポリシー(ログインなしで読める) */
export const photoLegalResponseSchema = z.object({ facilityName: z.string(), tokushoho: z.string(), terms: z.string(), privacy: z.string() });
export type PhotoLegalResponse = z.infer<typeof photoLegalResponseSchema>;
