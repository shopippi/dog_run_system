-- 2026-10-29 ダッシュボードの作り直し(docs/design.md 12.3)
-- 1) 郵便番号から調べた地域(都道府県・市区町村・町域)。調べるのは、まだこの表にない郵便番号だけ。
--    見つからなかった郵便番号も status = 'not_found' で残す(毎晩、同じ番号を調べ直さないため)。
--    つながらなかった・失敗したときは行を作らない(次の実行で調べ直す)。
CREATE TABLE IF NOT EXISTS postal_areas (
  postal_code TEXT PRIMARY KEY,                         -- 7桁の数字(ハイフンなし)
  prefecture TEXT,                                      -- 都道府県
  city TEXT,                                            -- 市区町村
  town TEXT,                                            -- 町域
  status TEXT NOT NULL DEFAULT 'found' CHECK (status IN ('found', 'not_found')),
  source TEXT,                                          -- 調べ先(zipcloud など)
  looked_up_at TEXT NOT NULL                            -- 調べた日時(日本時間)
);

-- 2) 管理者・受付スタッフの日々のメモ(「この日はイベントがあった」など)。1日に何件でも。
--    物理削除しない(消したときは deleted_at を入れる。操作ログから元に戻せる)。
CREATE TABLE IF NOT EXISTS day_notes (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,                                   -- 日本時間の日付
  body TEXT NOT NULL,                                   -- 本文(500文字まで)
  created_by_staff_id INTEGER REFERENCES staff_users(id),
  created_at TEXT NOT NULL,
  updated_by_staff_id INTEGER REFERENCES staff_users(id),
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_day_notes_date ON day_notes(date, deleted_at);

-- ダッシュボードの「どこから来ているか」で、郵便番号ごとに数えるため
CREATE INDEX IF NOT EXISTS idx_households_postal ON households(postal_code);
