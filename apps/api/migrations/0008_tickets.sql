-- 担当G: 無料券の「交換する」「使用する」(8章、C-06)
-- 追加だけ(既存の列は変えない)

-- 無料券との交換(POST /api/tickets/exchange)は、画面が作った印(op_id)を 'exchange:' を付けて券に入れる。
-- 同じ印の交換が二重に届いても券が2枚にならないよう、交換の印は一意にする
-- (手動の登録の印は1回の操作で複数の券に同じ値を入れるので、'exchange:' で始まるものだけを対象にする)
CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_g_exchange_op ON tickets(op_id) WHERE op_id LIKE 'exchange:%';

-- その日・そのおうちで使った無料券を探す(今日の来場の「無料券を使用」の印、チェックインとの結びつけ)
CREATE INDEX IF NOT EXISTS idx_tickets_g_used ON tickets(household_id, used_at);
