-- おうちの詳細と記録(A-02〜A-06、A-15)
-- 追加だけ(既存の列は変えない)

-- 操作ログを操作の種類と日付で絞り込むため(A-15)
CREATE INDEX idx_audit_log_action ON audit_log(action, created_at);
