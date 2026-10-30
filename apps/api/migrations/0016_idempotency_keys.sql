-- 電波が弱いときの二重送信を防ぐ「送信の印」(要件定義書 15.3)。
-- お客さん向けの変更(チェックイン・無料券の交換と使用・ワンちゃんの変更など)に、画面が Idempotency-Key ヘッダーで印を付ける。
-- 同じ人の同じ印は同じ送信とみなし、2回目からは1回目の応答をそのまま返す(ポイントや無料券が二重にならない)。
-- 業務の記録ではない(正しい記録は visits・point_ledger・tickets・audit_log にある)ため、
-- 7日より古い行は夜間の処理で消す(LINE のユーザーは、そのままではなくハッシュで持つ)。
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_hash TEXT NOT NULL,          -- LINE のユーザーID の SHA-256(先頭32文字)
  key TEXT NOT NULL,                -- 画面が作った印(UUID)
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  request_hash TEXT NOT NULL,       -- 送った内容の SHA-256。同じ印で中身が違う送信は受け付けない
  state TEXT NOT NULL,              -- processing(処理中)/ done(応答を保存済み)/ failed(やり直してよい)
  status INTEGER,                   -- 保存した応答の HTTP の番号
  response_body TEXT,               -- 保存した応答(JSON)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_hash, key)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created ON idempotency_keys(created_at);
