-- 旧カードからの移行(A-05、要件定義書 16章)の、受付での入力の記録。追加だけ(既存の列は変えない)。
--
-- * ポイントの残高は、これまでどおり point_ledger(kind = 'migration')から計算する。この表は残高に使わない。
--   引き継いだときの「旧カードに残っていたポイント」「上限で切った分」「特典チケットから出した無料券の枚数」
--   「カードの番号・メモ」を残し、同じカードが別のおうちで使われていないかを探すために使う。
-- * 行は消さない。元に戻したときは undone_at と undone_by_staff_id を入れる(操作ログからも辿れる)。
-- * 1つの入力ごとに1行。操作ログ(audit_log)の行とは audit_id で、point_ledger の移行の行とは household_id・source・created_at で結びつく。
CREATE TABLE IF NOT EXISTS migration_cards (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  source TEXT NOT NULL CHECK (source IN ('line_card', 'paper_card')),
  points INTEGER NOT NULL,                 -- 引き継いだポイント(台帳に書いた数)
  card_points INTEGER,                     -- 旧カードに残っていたポイント(上限で切ったときは points より大きい)
  tickets INTEGER NOT NULL DEFAULT 0,      -- 旧カードの使っていない特典から出した無料券の枚数
  card_ref TEXT,                           -- 紙のカードの番号など(任意)
  card_ref_search TEXT,                    -- 探す用(全角・空白・ハイフンをそろえたもの)
  note TEXT,                               -- 受付のメモ(任意)
  late_reason TEXT,                        -- 移行期間のあとに受け付けた理由
  duplicate_of TEXT,                       -- 同じカードの番号がほかのおうちにあると分かったうえで入力したとき、その会員ID(JSONの配列)
  audit_id INTEGER REFERENCES audit_log(id),   -- この入力の操作ログ(引き継ぎ済みの一覧と、元に戻すときに使う)
  staff_id INTEGER NOT NULL REFERENCES staff_users(id),
  created_at TEXT NOT NULL,
  undone_at TEXT,
  undone_by_staff_id INTEGER REFERENCES staff_users(id)
);
CREATE INDEX IF NOT EXISTS idx_migration_cards_household ON migration_cards(household_id);
CREATE INDEX IF NOT EXISTS idx_migration_cards_audit ON migration_cards(audit_id);
CREATE INDEX IF NOT EXISTS idx_migration_cards_ref ON migration_cards(card_ref_search) WHERE card_ref_search IS NOT NULL;

-- お客さんの会員証に出す「前のカードのポイントを引き継げます」の案内を、閉じた日時(家族 = LINE アカウントごと)
ALTER TABLE family_members ADD COLUMN oldcard_notice_closed_at TEXT;
