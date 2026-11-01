-- 預かり・お泊まりの予約(要件定義書 21章。2026-10-31 の決定)
--
-- * 予約は「おうち」と「ワンちゃん」に付ける。申し込んだ家族(LINEアカウント)は記録だけ(requested_by_member_id)。
-- * 物理削除しない。お断り・キャンセル・来なかったは状態で表し、操作ログ(audit_log)から元に戻せる。
-- * 日付は日本時間("2026-11-03")、時刻は "09:00"、日時は "2026-11-03T09:00:00+09:00"。
-- * 残高の列はない(ポイントとは関係しない)。料金は「目安」を予約したときの設定で記録するだけ(支払いは受付)。

CREATE TABLE bookings (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  service TEXT NOT NULL CHECK (service IN ('daycare', 'boarding')),           -- 預かり / お泊まり
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled', 'checked_in', 'completed', 'no_show')),
  start_date TEXT NOT NULL,                       -- 預かり: その日 / お泊まり: チェックインの日
  end_date TEXT NOT NULL,                         -- 預かり: 同じ日 / お泊まり: チェックアウトの日
  start_time TEXT NOT NULL,                       -- 預ける時刻 / チェックインの時刻("09:00")
  end_time TEXT NOT NULL,                         -- お迎えの時刻 / チェックアウトの時刻
  occupy_from TEXT NOT NULL,                      -- 受け入れ数を使う最初の日(含む)
  occupy_to TEXT NOT NULL,                        -- 受け入れ数を使う最後の日(含む。お泊まりはチェックアウトの前の日)
  note TEXT,                                      -- お客さんからお店へ(ごはん・お薬・体調など)
  checklist TEXT NOT NULL DEFAULT '[]',           -- 印を付けた「確かめてもらうこと」(JSON の配列)
  estimate_total INTEGER NOT NULL,                -- 料金の目安(円。予約したときの設定で計算)
  estimate_detail TEXT NOT NULL,                  -- 料金の目安の内訳(JSON)
  source TEXT NOT NULL CHECK (source IN ('customer', 'staff')),             -- お客さんが LINE から / 受付で手入力
  approval_reason TEXT CHECK (approval_reason IN ('first_time', 'approve_all')), -- 確認待ちにした理由(すぐ確定なら NULL)
  requested_by_member_id INTEGER REFERENCES family_members(id),            -- 申し込んだ家族(記録だけ)
  created_by_staff_id INTEGER REFERENCES staff_users(id),                   -- 手入力したスタッフ
  token TEXT NOT NULL UNIQUE,                     -- 同じ送信の中で、ワンちゃんの行と結ぶための印
  staff_note TEXT,                                -- 受付のメモ(電話で受けた、など)
  capacity_override_reason TEXT,                  -- いっぱいの日に入れた理由(管理者だけ)
  decided_at TEXT,
  decided_by_staff_id INTEGER REFERENCES staff_users(id),
  decision_message TEXT,                          -- 承認・お断りのときのお客さんへの一言
  cancelled_at TEXT,
  cancelled_by_type TEXT CHECK (cancelled_by_type IN ('member', 'staff')),
  cancelled_by_id INTEGER,
  cancel_reason TEXT,
  checked_in_at TEXT,
  checked_in_by_staff_id INTEGER REFERENCES staff_users(id),
  completed_at TEXT,
  completed_by_staff_id INTEGER REFERENCES staff_users(id),
  no_show_at TEXT,
  no_show_by_staff_id INTEGER REFERENCES staff_users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_bookings_occupy ON bookings(service, occupy_from, occupy_to);
CREATE INDEX idx_bookings_household ON bookings(household_id);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_dates ON bookings(start_date, end_date);

CREATE TABLE booking_dogs (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  dog_id INTEGER NOT NULL REFERENCES dogs(id),
  size TEXT NOT NULL CHECK (size IN ('small', 'medium', 'large')),          -- 予約したときのサイズ(受け入れ数はこれで数える)
  first_time INTEGER NOT NULL DEFAULT 0 CHECK (first_time IN (0, 1)),       -- 予約したときに、はじめてのワンちゃんだったか
  UNIQUE (booking_id, dog_id)
);
CREATE INDEX idx_booking_dogs_dog ON booking_dogs(dog_id);

-- その日の受け入れ数の上書き(休みにする・数を変える)。消すときは deleted_at を入れる(行は消さない)
CREATE TABLE booking_capacity_overrides (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  service TEXT NOT NULL CHECK (service IN ('daycare', 'boarding')),
  closed INTEGER NOT NULL DEFAULT 0 CHECK (closed IN (0, 1)),
  cap_small INTEGER CHECK (cap_small IS NULL OR cap_small BETWEEN 0 AND 100),   -- NULL はいつもの数
  cap_medium INTEGER CHECK (cap_medium IS NULL OR cap_medium BETWEEN 0 AND 100),
  cap_large INTEGER CHECK (cap_large IS NULL OR cap_large BETWEEN 0 AND 100),
  note TEXT,
  created_by_staff_id INTEGER REFERENCES staff_users(id),
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by_staff_id INTEGER REFERENCES staff_users(id)
);
CREATE UNIQUE INDEX uq_booking_overrides_active ON booking_capacity_overrides(date, service) WHERE deleted_at IS NULL;

-- LINE のお知らせの記録(確定・お断り)。送れなくても予約は止めない。ひと月の数はここから数える
CREATE TABLE booking_notifications (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  kind TEXT NOT NULL CHECK (kind IN ('confirmed', 'declined')),
  member_id INTEGER REFERENCES family_members(id),                          -- 送り先の家族
  status TEXT NOT NULL CHECK (status IN ('sent', 'skipped', 'failed')),
  reason TEXT,                                    -- no_token / disabled / monthly_limit / no_recipient / manual_entry / mock / not_friend / http_error / network
  detail TEXT,                                    -- LINE から返ってきた内容など(製作者向け)
  message TEXT NOT NULL,                          -- 送った(送るはずだった)文
  month TEXT NOT NULL,                            -- "2026-10"(ひと月の数を数える)
  created_at TEXT NOT NULL
);
CREATE INDEX idx_booking_notifications_booking ON booking_notifications(booking_id);
CREATE INDEX idx_booking_notifications_month ON booking_notifications(month, status);

-- 最後の1枠を2人が同時に取らないための見張り(1行だけ)。予約を入れる送信の最後で ok を計算し直し、
-- 受け入れ数を超えていれば CHECK に引っかかって送信の全体が取り消される(D1 の batch は1つのトランザクション)
CREATE TABLE booking_guard (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 1 CHECK (ok = 1)
);
INSERT INTO booking_guard (id, version, ok) VALUES (1, 0, 1);

-- 「預かり経験あり」の印(紙の台帳のころに預かったことのある子。管理者が付ける。操作ログから元に戻せる)
ALTER TABLE dogs ADD COLUMN stay_experience_at TEXT;
ALTER TABLE dogs ADD COLUMN stay_experience_by_staff_id INTEGER REFERENCES staff_users(id);
