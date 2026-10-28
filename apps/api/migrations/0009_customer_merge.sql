-- 担当H: お客さん同士でおうちをまとめる(C-12、要件定義書 5.1・5.3)
--
-- お客さんが招待を開いて、本人の確認だけでおうちをまとめられるようにする。
-- まとめた人がスタッフではなくお客さんになるため、merges の「実行したスタッフ」を空にできるようにし、
-- 「実行したお客さん」と「使った招待」を足す。
--
-- SQLite では列の NOT NULL を外せないため、merges だけは作り直す(列の名前と中身はそのまま)。
-- point_ledger.merge_id が merges を指しているので、外部キーの確かめを最後まで待たせ、
-- 古い表を消したあと、新しい表に同じ id で入れ直す(入れ直した時点で参照が元どおりになる)。
PRAGMA defer_foreign_keys = on;

CREATE TABLE merges_copy AS SELECT * FROM merges;
DROP TABLE merges;

CREATE TABLE merges (
  id INTEGER PRIMARY KEY,
  kept_household_id INTEGER NOT NULL REFERENCES households(id),
  absorbed_household_id INTEGER NOT NULL REFERENCES households(id),
  dog_pairs TEXT NOT NULL,                                  -- JSON: [{ keep: 犬id, absorb: 犬id, take: 'keep' | 'absorb', photo?: 'keep' | 'absorb' }]
  snapshot TEXT NOT NULL,                                   -- JSON: 統合前の状態(元に戻すため)
  request_id INTEGER REFERENCES requests(id),
  executed_by_staff_id INTEGER REFERENCES staff_users(id),  -- 管理者がまとめたとき
  executed_at TEXT NOT NULL,
  undone_at TEXT,
  undone_by_staff_id INTEGER REFERENCES staff_users(id),
  executed_by_member_id INTEGER REFERENCES family_members(id), -- お客さんが招待からまとめたとき
  invite_id INTEGER REFERENCES invites(id),                 -- お客さんがまとめたときに使った招待
  CHECK (executed_by_staff_id IS NOT NULL OR executed_by_member_id IS NOT NULL)
);
INSERT INTO merges (id, kept_household_id, absorbed_household_id, dog_pairs, snapshot, request_id, executed_by_staff_id,
                    executed_at, undone_at, undone_by_staff_id)
  SELECT id, kept_household_id, absorbed_household_id, dog_pairs, snapshot, request_id, executed_by_staff_id,
         executed_at, undone_at, undone_by_staff_id
    FROM merges_copy ORDER BY id;
DROP TABLE merges_copy;
CREATE INDEX idx_merges_kept ON merges(kept_household_id);
CREATE INDEX idx_merges_absorbed ON merges(absorbed_household_id);

-- まとめられた側の家族に、次に会員証を開いたとき「おうちが一つになりました」と1回だけ出すための印。
-- 出したら NULL に戻す(まとめた本人には完了の画面で伝えるので付けない)
ALTER TABLE family_members ADD COLUMN merge_notice_id INTEGER REFERENCES merges(id);
