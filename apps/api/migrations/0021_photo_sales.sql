-- 写真販売(docs/photo-requirements.md。2026-11-01 の決定)
--
-- * 同じ Worker・同じ D1。ID はほかの表と同じ INTEGER(連番)。推測されても困らないよう、すべての API で
--   「ログイン中の本人のものか」「公開中か」を確かめる。ファイルの置き場所のキーだけは推測できないランダムな UUID にする。
-- * 日付は日本時間("2026-11-03")、日時は "2026-11-03T09:00:00+09:00"。
-- * 業務の記録(注文・明細・購入の権利・アルバムへの掲載など)は物理削除しない。状態と日時で表し、管理者の操作は audit_log に残す。
-- * ただ一つの例外: 販売期間が終わったアルバムの、売れなかった写真の「ファイル」(原本・プレビュー・サムネイル・中サイズ)は、
--   置き場所の費用のために消す(photos.files_deleted_at を入れる。行は消さない)。購入済み領域のファイルは消さない。
-- * 管理者の操作ログは、既存の audit_log を使う(target_type = 'photo_album' など)。

-- 購入者(LINE アカウントごと)。家族(family_members)は使わない:
--   会員でない LINE ユーザーも買える / 家族を抜けても購入した写真は本人に残る / 将来のメールでの購入にも同じ表を使うため。
-- household_id は記録だけ(将来の家族共有のため)。購入の権利は購入者ごと(家族で共有しない)。
CREATE TABLE photo_customers (
  id INTEGER PRIMARY KEY,
  line_user_id TEXT,                               -- 退会時に消すため NULL を許す
  email TEXT,                                      -- 将来(メールでの購入)。いまは使わない
  display_name TEXT,                               -- LINE の表示名(最後に見たもの)
  family_member_id INTEGER REFERENCES family_members(id), -- 会員なら、最後に見た家族ID(記録だけ)
  household_id INTEGER REFERENCES households(id),  -- 会員なら、最後に見たおうち(記録だけ)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  personal_data_deleted_at TEXT                    -- 退会で個人情報を消した日時
);
CREATE UNIQUE INDEX uq_photo_customers_line ON photo_customers(line_user_id) WHERE line_user_id IS NOT NULL;
CREATE UNIQUE INDEX uq_photo_customers_email ON photo_customers(email) WHERE email IS NOT NULL;

-- 価格表(再利用できる価格のセット)。価格は税込みの整数円。Stripe の日本円の最低額は 50 円
CREATE TABLE price_lists (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  unit_price INTEGER NOT NULL CHECK (unit_price BETWEEN 50 AND 1000000),
  album_price INTEGER CHECK (album_price IS NULL OR album_price BETWEEN 50 AND 10000000),
  is_default_for TEXT CHECK (is_default_for IN ('date', 'event')),  -- 新しいアルバムに自動で付く種類
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')), -- archived = 新しいアルバムでは選べない(使っているアルバムはそのまま)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_price_lists_default ON price_lists(is_default_for) WHERE is_default_for IS NOT NULL;
-- 初期案(20章。管理画面の価格表で変えられる)
INSERT INTO price_lists (id, name, unit_price, album_price, is_default_for, status, created_at, updated_at) VALUES
  (1, '通常', 500, NULL, 'date', 'active', '2026-11-01T00:00:00+09:00', '2026-11-01T00:00:00+09:00'),
  (2, 'イベント', 800, NULL, 'event', 'active', '2026-11-01T00:00:00+09:00', '2026-11-01T00:00:00+09:00');

-- アルバム(日付 / イベント)。価格と販売期間はアルバム単位
CREATE TABLE albums (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('date', 'event')),
  event_date TEXT NOT NULL,                        -- 開催日
  price_list_id INTEGER NOT NULL REFERENCES price_lists(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'ended')),
  published_at TEXT,                               -- 最初に公開した日時(販売開始)
  sale_ends_at TEXT,                               -- 販売終了の日時(既定 = 公開 + 6か月。延長できる)
  cover_photo_id INTEGER REFERENCES photos(id),
  source_folder TEXT,                              -- 一斉アップロードで作ったときのフォルダ名
  ended_at TEXT,                                   -- 販売終了にした日時(自動処理)
  deletion_notice_at TEXT,                         -- 削除の7日前のお知らせを出した日時
  files_deleted_at TEXT,                           -- 売れなかった写真のファイルを消した日時
  removed_at TEXT,                                 -- 管理者が一覧から外した(行は消さない。元に戻せる)
  created_by_staff_id INTEGER REFERENCES staff_users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_albums_list ON albums(status, event_date);
CREATE INDEX idx_albums_sale_end ON albums(status, sale_ends_at);

-- 写真(原本1枚 = 1行)。同じ写真を複数のアルバムに載せられる(album_photos)。
-- 原本は一度もデコード・再エンコードしない。sha256 はブラウザで計算し、アップロード後と購入済み領域へのコピー後にサーバーで確かめる
CREATE TABLE photos (
  id INTEGER PRIMARY KEY,
  original_key TEXT NOT NULL UNIQUE,               -- originals/{uuid}/{uuid}.jpg(元のファイル名を含めない)
  preview_key TEXT,                                -- preview/{uuid}/{uuid}.jpg(長辺1200px・透かしあり)
  thumb_key TEXT,                                  -- thumb/{uuid}/{uuid}.jpg(長辺400px・透かしあり)
  view_key TEXT,                                   -- view/{uuid}/{uuid}.jpg(長辺2048px・透かしなし。購入者だけ)
  purchased_key TEXT UNIQUE,                       -- purchased/{uuid}/{uuid}.jpg(最初に売れたときに原本をコピー。消さない。購入者全員で共有)
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/heic', 'image/heif')),
  width INTEGER,
  height INTEGER,
  original_filename TEXT NOT NULL,                 -- 管理画面と、ダウンロードのファイル名に使う
  taken_at TEXT,                                   -- 撮影日時(分かれば。並び替えは任意の操作)
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'ready', 'failed')),
  sha256_verified_at TEXT,                         -- アップロード後にサーバーでハッシュが一致した
  purchased_verified_at TEXT,                      -- 購入済み領域へのコピー後にハッシュが一致した
  hash_mismatch_at TEXT,                           -- どこかでハッシュが合わなかった(管理者・製作者に知らせる)
  files_deleted_at TEXT,                           -- 販売終了で、原本・プレビュー・サムネイル・中サイズのファイルを消した
  uploaded_by_staff_id INTEGER REFERENCES staff_users(id),
  created_at TEXT NOT NULL,
  uploaded_at TEXT                                 -- アップロードが終わった日時
);
CREATE INDEX idx_photos_sha256 ON photos(sha256);

-- アルバムへの掲載。price_override が NULL なら価格表に従う
CREATE TABLE album_photos (
  id INTEGER PRIMARY KEY,
  album_id INTEGER NOT NULL REFERENCES albums(id),
  photo_id INTEGER NOT NULL REFERENCES photos(id),
  sort_order INTEGER NOT NULL,                     -- 既定はファイル名の順
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'hidden', 'removed')), -- removed = 管理者が外した(売れた写真は外せない。非公開だけ)
  price_override INTEGER CHECK (price_override IS NULL OR price_override BETWEEN 50 AND 1000000),
  published_at TEXT,                               -- 公開した日時(まるごと購入の対象を決める)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (album_id, photo_id)
);
CREATE INDEX idx_album_photos_album ON album_photos(album_id, status, sort_order);
CREATE INDEX idx_album_photos_photo ON album_photos(photo_id);

-- アップロードの途中の記録(途中で切れても続きから。原本はマルチパート)
CREATE TABLE photo_uploads (
  id TEXT PRIMARY KEY,                             -- ランダムな UUID(画面に渡す)
  photo_id INTEGER NOT NULL REFERENCES photos(id),
  album_id INTEGER NOT NULL REFERENCES albums(id),
  storage TEXT NOT NULL CHECK (storage IN ('r2', 'fallback')),
  multipart_upload_id TEXT,                        -- R2 のマルチパートの ID(fallback では NULL)
  part_size INTEGER NOT NULL,
  part_count INTEGER NOT NULL,
  derivatives TEXT NOT NULL DEFAULT '[]',          -- 送り終えたプレビューなど(JSON の配列: "preview" / "thumb" / "view")
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'completed', 'aborted', 'failed')),
  created_by_staff_id INTEGER REFERENCES staff_users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_photo_uploads_status ON photo_uploads(status, created_at);

-- カート(サーバー側。購入者ごと。LIFF を開き直しても、別の端末でも同じ中身)。1行 = 写真1枚 か アルバムまるごと。
-- 外した・注文に入れたものは行を消さず、removed_at・ordered_at を入れる。金額は持たない(見るたびに DB から計算する)
CREATE TABLE cart_items (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES photo_customers(id),
  kind TEXT NOT NULL CHECK (kind IN ('photo', 'album')),
  album_id INTEGER NOT NULL REFERENCES albums(id),  -- 写真1枚のときは、どのアルバムから入れたか(価格はこのアルバムで決める)
  photo_id INTEGER REFERENCES photos(id),
  added_at TEXT NOT NULL,
  removed_at TEXT,                                 -- お客さんが外した
  ordered_at TEXT,                                 -- お支払いが確定した注文に入った
  order_id INTEGER REFERENCES orders(id),
  CHECK ((kind = 'photo' AND photo_id IS NOT NULL) OR (kind = 'album' AND photo_id IS NULL))
);
-- 同じ写真は2回入れられない(ほかのアルバムからでも)。同じアルバムのまるごとも1つだけ
CREATE UNIQUE INDEX uq_cart_items_photo ON cart_items(customer_id, photo_id) WHERE kind = 'photo' AND removed_at IS NULL AND ordered_at IS NULL;
CREATE UNIQUE INDEX uq_cart_items_album ON cart_items(customer_id, album_id) WHERE kind = 'album' AND removed_at IS NULL AND ordered_at IS NULL;
CREATE INDEX idx_cart_items_customer ON cart_items(customer_id, removed_at, ordered_at);

-- 注文。確定は署名を確かめた Webhook だけ(完了の画面では確定しない)
CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES photo_customers(id),
  household_id INTEGER REFERENCES households(id),  -- 記録だけ
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'refunded', 'partially_refunded', 'expired', 'canceled')),
  amount INTEGER NOT NULL CHECK (amount >= 0),     -- 合計(税込み・円。サーバーが DB から計算)
  currency TEXT NOT NULL DEFAULT 'jpy',
  payment_mode TEXT NOT NULL CHECK (payment_mode IN ('live', 'mock')), -- mock = local・test のまねの Stripe
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent TEXT,
  request_key TEXT,                                -- 送信の印(同じ送信で注文を二重に作らない)
  expires_at TEXT,                                 -- Checkout の期限
  paid_at TEXT,
  refunded_amount INTEGER NOT NULL DEFAULT 0,      -- 返金した合計(明細の refund_amount の合計と同じ。画面の表示用の写し)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_orders_request_key ON orders(request_key) WHERE request_key IS NOT NULL;
CREATE INDEX idx_orders_customer ON orders(customer_id, created_at);
CREATE INDEX idx_orders_status ON orders(status, created_at);

-- 注文の明細。価格と名前は注文した時点で固定
CREATE TABLE order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  kind TEXT NOT NULL CHECK (kind IN ('photo', 'album')),
  album_id INTEGER NOT NULL REFERENCES albums(id),
  photo_id INTEGER REFERENCES photos(id),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  label TEXT NOT NULL,                             -- 「2026/11/03 の写真 IMG_0012」など(注文した時点)
  refunded_at TEXT,
  refund_amount INTEGER,
  stripe_refund_id TEXT,
  refund_reason TEXT,
  refund_override INTEGER NOT NULL DEFAULT 0 CHECK (refund_override IN (0, 1)), -- 7日・未ダウンロードの条件の外で、管理者が理由を書いて返金した
  refunded_by_staff_id INTEGER REFERENCES staff_users(id),
  CHECK ((kind = 'photo' AND photo_id IS NOT NULL) OR (kind = 'album' AND photo_id IS NULL))
);
CREATE INDEX idx_order_items_order ON order_items(order_id);

-- 購入の権利(「この人はこの写真を持っている」)。ダウンロードできるかの唯一の判定元。購入者ごと(家族で共有しない)
CREATE TABLE entitlements (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES photo_customers(id),
  photo_id INTEGER NOT NULL REFERENCES photos(id),
  order_item_id INTEGER NOT NULL REFERENCES order_items(id),
  granted_at TEXT NOT NULL,
  revoked_at TEXT,                                 -- 返金で無効にした
  revoke_reason TEXT
);
-- 同じ人の同じ写真の、有効な権利は1つだけ(まるごと購入で、前に1枚で買った写真は足さない)
CREATE UNIQUE INDEX uq_entitlements_active ON entitlements(customer_id, photo_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_entitlements_item ON entitlements(order_item_id);

-- ダウンロードの記録(回数の上限: 写真1枚につき24時間で10回。不正の調べにも使う)
CREATE TABLE download_logs (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES photo_customers(id),
  photo_id INTEGER NOT NULL REFERENCES photos(id),
  entitlement_id INTEGER REFERENCES entitlements(id),
  kind TEXT NOT NULL CHECK (kind IN ('original', 'zip')),
  ip_hash TEXT,                                    -- IP アドレスのハッシュ(そのものは残さない)
  user_agent TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_download_logs_limit ON download_logs(customer_id, photo_id, created_at);

-- Stripe の Webhook の二重処理を防ぐ
CREATE TABLE webhook_events (
  stripe_event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'processed', 'ignored', 'failed')),
  error TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT
);

-- 購入完了の LINE のお知らせの記録。予約のお知らせ(booking_notifications)と合わせて、ひと月の上限を数える
CREATE TABLE photo_notifications (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  customer_id INTEGER REFERENCES photo_customers(id),
  kind TEXT NOT NULL CHECK (kind IN ('purchase_complete')),
  status TEXT NOT NULL CHECK (status IN ('sent', 'skipped', 'failed')),
  reason TEXT,                                     -- no_token / disabled / monthly_limit / no_recipient / mock / not_friend / http_error / network
  detail TEXT,
  message TEXT NOT NULL,
  month TEXT NOT NULL,                             -- "2026-11"
  created_at TEXT NOT NULL
);
CREATE INDEX idx_photo_notifications_month ON photo_notifications(month, status);
CREATE UNIQUE INDEX uq_photo_notifications_order ON photo_notifications(order_id, kind) WHERE status = 'sent';
