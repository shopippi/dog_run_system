-- おうちの詳細と記録(A-02〜A-06、A-15)
-- 追加だけ(既存の列は変えない)

-- 操作ログを操作の種類と日付で絞り込むため(A-15)
CREATE INDEX idx_audit_log_action ON audit_log(action, created_at);

-- ポイントの手動登録(A-03)で書いた台帳の行と無料券に、同じ操作の印を付ける(操作ログから元に戻すため)
ALTER TABLE point_ledger ADD COLUMN op_id TEXT;
ALTER TABLE tickets ADD COLUMN op_id TEXT;
CREATE INDEX idx_point_ledger_op ON point_ledger(op_id);
CREATE INDEX idx_tickets_op ON tickets(op_id);
