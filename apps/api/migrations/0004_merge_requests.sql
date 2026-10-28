-- 担当B: おうちの統合(A-07)・確認待ち(A-08)・旧カードの移行(A-05)
-- 追加だけ(既存の列は変えない)。ほかの担当の索引と名前がぶつからないよう、名前に _b_ を付ける

-- 統合を元に戻すとき・統合後の変更を調べるときに、統合の台帳の行を探す
CREATE INDEX IF NOT EXISTS idx_point_ledger_b_merge ON point_ledger(merge_id);
