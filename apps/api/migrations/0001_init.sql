-- ドッグラン LINE会員・分析システム 初期スキーマ(要件定義書 11章)
--
-- 方針
-- * 日時は日本時間の文字列 "2026-10-28T09:15:00+09:00"、日付は "2026-10-28" で保存する。
-- * ポイントと無料券の残高の列は持たない。point_ledger と tickets から計算する。
-- * 物理削除はしない。状態の列と audit_log で扱う(退会時の個人情報の削除だけは例外)。
-- * 会員ID(DR-000123)・犬ID(DR-000123-1)とは別に、内部の連番(id)を主キーにする。

-- ============================================================
-- 11.1 おうち・家族・犬
-- ============================================================

CREATE TABLE households (
  id INTEGER PRIMARY KEY,
  member_no TEXT NOT NULL UNIQUE,                 -- 会員ID DR-000123
  display_name TEXT NOT NULL,                     -- おうちの呼び名
  display_name_search TEXT NOT NULL,              -- 検索用(ひらがな・小文字にそろえたもの)
  display_name_auto INTEGER NOT NULL DEFAULT 1 CHECK (display_name_auto IN (0, 1)),
  registered_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'new' CHECK (source IN ('new', 'migration')),
  postal_code TEXT,                               -- 郵便番号(任意。ハイフンなし7桁)
  referral TEXT,                                  -- 知ったきっかけ
  transport TEXT,                                 -- ふだんの来場手段
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged', 'withdrawn')),
  merged_into_id INTEGER REFERENCES households(id),
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_households_status ON households(status);
CREATE INDEX idx_households_registered_at ON households(registered_at);

CREATE TABLE family_members (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  line_user_id TEXT,                              -- 退会時に削除するため NULL を許す
  line_display_name TEXT,
  line_display_name_search TEXT,
  age_group TEXT,
  gender TEXT,
  consented_at TEXT,                              -- 利用規約・プライバシーポリシーに同意した日時
  joined_at TEXT NOT NULL,
  join_method TEXT NOT NULL CHECK (join_method IN ('register', 'invite', 'reception', 'merge')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left', 'withdrawn')),
  left_at TEXT,
  updated_at TEXT NOT NULL
);
-- 1つのLINEアカウントが同時に入れるおうちは1つだけ。抜けたあとは新しいおうちを作り直せる。
CREATE UNIQUE INDEX uq_family_members_line_user_active
  ON family_members(line_user_id) WHERE status = 'active';
CREATE INDEX idx_family_members_household ON family_members(household_id);
CREATE INDEX idx_family_members_line_user ON family_members(line_user_id);

CREATE TABLE invites (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  household_id INTEGER NOT NULL REFERENCES households(id),
  kind TEXT NOT NULL CHECK (kind IN ('family', 'reception')),
  created_by_member_id INTEGER REFERENCES family_members(id),
  created_by_staff_id INTEGER REFERENCES staff_users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_by_member_id INTEGER REFERENCES family_members(id),
  used_at TEXT,
  -- まとめる申請になった場合の申請
  request_id INTEGER REFERENCES requests(id)
);
CREATE INDEX idx_invites_household ON invites(household_id);

CREATE TABLE breeds (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  default_size TEXT NOT NULL CHECK (default_size IN ('small', 'medium', 'large')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  is_other INTEGER NOT NULL DEFAULT 0 CHECK (is_other IN (0, 1)) -- 「その他」(自由入力)
);

CREATE TABLE dogs (
  id INTEGER PRIMARY KEY,
  dog_no TEXT NOT NULL UNIQUE,                    -- 犬ID DR-000123-1
  household_id INTEGER NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  name_search TEXT NOT NULL,
  photo_key TEXT,                                 -- R2 のキー(長い辺 800px)
  thumb_key TEXT,                                 -- R2 のキー(一覧用の正方形)
  breed_id INTEGER NOT NULL REFERENCES breeds(id),
  breed_other TEXT,                               -- 「その他」を選んだときの自由入力
  size TEXT NOT NULL CHECK (size IN ('small', 'medium', 'large')),
  sex TEXT CHECK (sex IN ('male', 'female')),
  birth_ym TEXT,                                  -- 生まれた年月 "2020-04"
  neutered TEXT CHECK (neutered IN ('yes', 'no', 'no_answer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired', 'merged')),
  merged_into_id INTEGER REFERENCES dogs(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_dogs_household ON dogs(household_id);
CREATE INDEX idx_dogs_name_search ON dogs(name_search);
CREATE INDEX idx_dogs_photo_key ON dogs(photo_key);
CREATE INDEX idx_dogs_thumb_key ON dogs(thumb_key);

CREATE TABLE dog_changes (
  id INTEGER PRIMARY KEY,
  dog_id INTEGER NOT NULL REFERENCES dogs(id),
  field TEXT NOT NULL,
  before_value TEXT,
  after_value TEXT,
  reason TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('member', 'staff', 'system')),
  actor_id INTEGER,
  changed_at TEXT NOT NULL
);
CREATE INDEX idx_dog_changes_dog ON dog_changes(dog_id);

-- ============================================================
-- 11.2 来場・ポイント・統合
-- ============================================================

CREATE TABLE visits (
  id INTEGER PRIMARY KEY,
  household_id INTEGER REFERENCES households(id),           -- 会員以外は NULL
  checked_in_member_id INTEGER REFERENCES family_members(id),
  visit_date TEXT NOT NULL,                                  -- 日本時間の来場日
  checked_in_at TEXT NOT NULL,
  dog_count INTEGER NOT NULL CHECK (dog_count >= 0),
  used_ticket INTEGER NOT NULL DEFAULT 0 CHECK (used_ticket IN (0, 1)),
  method TEXT NOT NULL CHECK (method IN ('self', 'proxy', 'walkin')),
  created_by_staff_id INTEGER REFERENCES staff_users(id),
  cancelled_at TEXT,
  cancel_reason TEXT,
  cancelled_by_staff_id INTEGER REFERENCES staff_users(id)
);
-- おうちごとに1日1回(会員以外と取り消し済みを除く)
CREATE UNIQUE INDEX uq_visits_household_date
  ON visits(household_id, visit_date)
  WHERE household_id IS NOT NULL AND cancelled_at IS NULL;
CREATE INDEX idx_visits_date ON visits(visit_date);
CREATE INDEX idx_visits_household ON visits(household_id);

CREATE TABLE visit_dogs (
  id INTEGER PRIMARY KEY,
  visit_id INTEGER NOT NULL REFERENCES visits(id),
  dog_id INTEGER NOT NULL REFERENCES dogs(id),
  visit_date TEXT NOT NULL,
  added_by_member_id INTEGER REFERENCES family_members(id),
  created_at TEXT NOT NULL,
  UNIQUE (visit_id, dog_id)
);
CREATE INDEX idx_visit_dogs_dog ON visit_dogs(dog_id);
CREATE INDEX idx_visit_dogs_date ON visit_dogs(visit_date);

CREATE TABLE tickets (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  issued_at TEXT NOT NULL,
  expires_at TEXT,                                          -- NULL は期限なし
  source TEXT NOT NULL CHECK (source IN ('points', 'manual', 'merge', 'migration')),
  issued_visit_id INTEGER REFERENCES visits(id),            -- 来場でポイントがたまって発行した場合
  used_visit_id INTEGER REFERENCES visits(id),
  used_at TEXT,
  status TEXT NOT NULL DEFAULT 'unused' CHECK (status IN ('unused', 'used', 'expired', 'void')),
  note TEXT
);
CREATE INDEX idx_tickets_household_status ON tickets(household_id, status);
CREATE INDEX idx_tickets_used_visit ON tickets(used_visit_id);
CREATE INDEX idx_tickets_issued_visit ON tickets(issued_visit_id);

CREATE TABLE point_ledger (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  delta INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('visit', 'ticket_issue', 'cancel', 'migration', 'manual', 'merge', 'expire')),
  visit_id INTEGER REFERENCES visits(id),
  ticket_id INTEGER REFERENCES tickets(id),
  merge_id INTEGER REFERENCES merges(id),
  migration_source TEXT CHECK (migration_source IN ('line_card', 'paper_card')),
  reason TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('member', 'staff', 'system')),
  actor_id INTEGER,
  created_at TEXT NOT NULL,
  expires_at TEXT,                                          -- NULL は期限なし
  reverses_id INTEGER REFERENCES point_ledger(id)           -- 元に戻した記録の場合、戻した対象
);
CREATE INDEX idx_point_ledger_household ON point_ledger(household_id);
CREATE INDEX idx_point_ledger_visit ON point_ledger(visit_id);

CREATE TABLE merges (
  id INTEGER PRIMARY KEY,
  kept_household_id INTEGER NOT NULL REFERENCES households(id),
  absorbed_household_id INTEGER NOT NULL REFERENCES households(id),
  dog_pairs TEXT NOT NULL,                                  -- JSON: [{ keep: 犬id, absorb: 犬id, take: 'keep' | 'absorb' }]
  snapshot TEXT NOT NULL,                                   -- JSON: 統合前の状態(元に戻すため)
  request_id INTEGER REFERENCES requests(id),
  executed_by_staff_id INTEGER NOT NULL REFERENCES staff_users(id),
  executed_at TEXT NOT NULL,
  undone_at TEXT,
  undone_by_staff_id INTEGER REFERENCES staff_users(id)
);
CREATE INDEX idx_merges_kept ON merges(kept_household_id);
CREATE INDEX idx_merges_absorbed ON merges(absorbed_household_id);

CREATE TABLE requests (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('migration', 'merge')),
  household_id INTEGER NOT NULL REFERENCES households(id),  -- 申請したおうち
  related_household_id INTEGER REFERENCES households(id),   -- まとめる相手のおうち
  requester_member_id INTEGER REFERENCES family_members(id),
  payload TEXT NOT NULL DEFAULT '{}',                       -- JSON: 申請の内容
  attachment_key TEXT,                                      -- R2 のキー(旧カードの写真)
  attachment_deleted_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL,
  handled_by_staff_id INTEGER REFERENCES staff_users(id),
  handled_at TEXT,
  handle_note TEXT
);
CREATE INDEX idx_requests_status ON requests(status, kind);
CREATE INDEX idx_requests_household ON requests(household_id);

-- ============================================================
-- 11.3 アンケート
-- ============================================================

CREATE TABLE survey_questions (
  id INTEGER PRIMARY KEY,
  fixed_key TEXT UNIQUE,                                    -- 固定の質問のキー(age_group など)。追加した質問は NULL
  target TEXT NOT NULL CHECK (target IN ('member', 'household')),
  kind TEXT NOT NULL CHECK (kind IN ('choice', 'text')),
  label TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '[]',                       -- JSON: 選択肢の配列
  required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  is_fixed INTEGER NOT NULL DEFAULT 0 CHECK (is_fixed IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE survey_answers (
  id INTEGER PRIMARY KEY,
  question_id INTEGER NOT NULL REFERENCES survey_questions(id),
  member_id INTEGER REFERENCES family_members(id),
  household_id INTEGER REFERENCES households(id),
  answer TEXT,                                              -- 答えなかった場合は NULL(skipped = 1)
  skipped INTEGER NOT NULL DEFAULT 0 CHECK (skipped IN (0, 1)),
  answered_at TEXT NOT NULL,
  CHECK (member_id IS NOT NULL OR household_id IS NOT NULL)
);
CREATE UNIQUE INDEX uq_survey_answers_member ON survey_answers(question_id, member_id) WHERE member_id IS NOT NULL;
CREATE UNIQUE INDEX uq_survey_answers_household ON survey_answers(question_id, household_id) WHERE household_id IS NOT NULL;

-- ============================================================
-- 11.4 分析用
-- ============================================================

CREATE TABLE daily_stats (
  date TEXT PRIMARY KEY,
  visit_groups INTEGER NOT NULL DEFAULT 0,                  -- 来場組数(会員以外を含む)
  dogs_member INTEGER NOT NULL DEFAULT 0,
  dogs_walkin INTEGER NOT NULL DEFAULT 0,
  new_households INTEGER NOT NULL DEFAULT 0,
  first_visit_households INTEGER NOT NULL DEFAULT 0,
  tickets_used INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE daily_weather (
  date TEXT PRIMARY KEY,
  weather TEXT,                                             -- 晴れ・曇り・雨 など
  temp_max REAL,
  temp_min REAL,
  precipitation REAL,
  station TEXT,
  source TEXT,
  fetched_at TEXT NOT NULL
);

CREATE TABLE calendar (
  date TEXT PRIMARY KEY,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0 = 日曜
  holiday_name TEXT,
  day_type TEXT NOT NULL CHECK (day_type IN ('weekday', 'saturday', 'sunday', 'holiday')),
  is_closed INTEGER NOT NULL DEFAULT 0 CHECK (is_closed IN (0, 1)),
  closed_note TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT,
  memo TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_events_date ON events(date);

-- ============================================================
-- 11.5 管理用
-- ============================================================

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,                                      -- JSON
  updated_at TEXT NOT NULL,
  updated_by_staff_id INTEGER REFERENCES staff_users(id)
);

CREATE TABLE staff_users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,                              -- pbkdf2-sha256$回数$salt$hash
  role TEXT NOT NULL CHECK (role IN ('staff', 'admin', 'developer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ログイン状態(30日間保つ)。トークンそのものは保存せず、ハッシュだけを持つ。
CREATE TABLE staff_sessions (
  id TEXT PRIMARY KEY,                                      -- トークンの SHA-256
  staff_id INTEGER NOT NULL REFERENCES staff_users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent TEXT
);
CREATE INDEX idx_staff_sessions_staff ON staff_sessions(staff_id);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('member', 'staff', 'system')),
  actor_id INTEGER,
  action TEXT NOT NULL,                                     -- 'visit.cancel' など
  target_type TEXT NOT NULL,
  target_id TEXT,
  before_value TEXT,                                        -- JSON
  after_value TEXT,                                         -- JSON
  reason TEXT,
  undo_info TEXT,                                           -- JSON: 元に戻すための情報
  created_at TEXT NOT NULL,
  undone_at TEXT,
  undone_by_staff_id INTEGER REFERENCES staff_users(id)
);
CREATE INDEX idx_audit_log_created ON audit_log(created_at);
CREATE INDEX idx_audit_log_target ON audit_log(target_type, target_id);

-- ============================================================
-- 初期データ
-- ============================================================

-- 犬種の選択肢(未決事項。管理画面で追加・並べ替えできる)
INSERT INTO breeds (name, default_size, sort_order, is_other) VALUES
  ('トイプードル', 'small', 10, 0),
  ('チワワ', 'small', 20, 0),
  ('ミニチュアダックスフンド', 'small', 30, 0),
  ('ポメラニアン', 'small', 40, 0),
  ('柴犬', 'medium', 50, 0),
  ('フレンチブルドッグ', 'medium', 60, 0),
  ('ボーダーコリー', 'medium', 70, 0),
  ('ゴールデンレトリバー', 'large', 80, 0),
  ('ラブラドールレトリバー', 'large', 90, 0),
  ('ミックス', 'small', 100, 0),
  ('その他', 'small', 999, 1);

-- 固定のアンケート(要件定義書 7.1)。回答は households / family_members の列に入る。
INSERT INTO survey_questions (fixed_key, target, kind, label, options, required, sort_order, is_fixed, created_at) VALUES
  ('age_group', 'member', 'choice', '年代', '["10代","20代","30代","40代","50代","60代","70代以上"]', 1, 10, 1, '2026-10-28T00:00:00+09:00'),
  ('gender', 'member', 'choice', '性別', '["女性","男性","答えない"]', 1, 20, 1, '2026-10-28T00:00:00+09:00'),
  ('postal_code', 'household', 'text', 'お住まいの郵便番号', '[]', 0, 30, 1, '2026-10-28T00:00:00+09:00'),
  ('referral', 'household', 'choice', 'このドッグランを知ったきっかけ', '["Instagram","Googleマップ","知人の紹介","通りがかり","ほかのドッグランで聞いた","その他"]', 1, 40, 1, '2026-10-28T00:00:00+09:00'),
  ('transport', 'household', 'choice', 'ふだんの来場手段', '["車","徒歩","自転車","電車やバス"]', 0, 50, 1, '2026-10-28T00:00:00+09:00');

-- 受付の固定QRコードの合言葉。環境ごとにランダムに作る(管理画面から変えられる)。
INSERT INTO settings (key, value, updated_at) VALUES
  ('checkin_passphrase', '"' || lower(hex(randomblob(16))) || '"', '2026-10-28T00:00:00+09:00');
