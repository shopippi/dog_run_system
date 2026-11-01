-- 旧カードの引き継ぎを「1おうちの移行元ごとに1回」から「1枚のカードごとに1回」に変える(2026-10-30 の決定。16.1)。追加だけ。
--
-- * 引き継ぐたびに、だれ(家族 = LINE アカウント)のカードかを残す(family_member_id)。
-- * LINE のショップカードは LINE のアカウントに1枚なので、家族1人につき1回。紙のカードも家族1人につき1回。
--   同じ家族・同じ移行元の、元に戻していない引き継ぎは1つだけ(下の一意の索引。同時に2回押されても1回だけになる)。
-- * 引き継いだ台帳の行(point_ledger)を ledger_id で結ぶ(元に戻すときに使う)。
-- * これより前の記録(family_member_id が空)は、だれのカードかが分からない記録として残し、ほかの引き継ぎは止めない。
ALTER TABLE migration_cards ADD COLUMN family_member_id INTEGER REFERENCES family_members(id);
ALTER TABLE migration_cards ADD COLUMN ledger_id INTEGER REFERENCES point_ledger(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_migration_cards_member_source
  ON migration_cards(family_member_id, source) WHERE undone_at IS NULL AND family_member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_migration_cards_member ON migration_cards(family_member_id);
