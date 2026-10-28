-- 自動処理の実行の記録(B-01〜B-06、A-17・D-02 システムの状態)
-- 天気の取得・祝日の取り込み・日別集計・バックアップ・有効期限の処理・移行用の画像の削除を、
-- 1回の実行ごとに1行残す。システムの状態の画面は、処理ごとの最後の行から緑・黄・赤を決める。
CREATE TABLE system_jobs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,                                       -- 'weather' | 'holidays' | 'daily_stats' | 'backup' | 'expiry' | 'migration_images'
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'warning', 'failed')),
  message TEXT                                              -- 画面に出す結果の説明(件数・失敗の理由)
);
CREATE INDEX idx_system_jobs_name ON system_jobs(name, started_at);

-- 天気(B-01)の判定に使った日照時間。晴れ・曇りの判定を後から確かめられるように残す
ALTER TABLE daily_weather ADD COLUMN sunshine_hours REAL;
