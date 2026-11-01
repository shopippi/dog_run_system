-- 写真の保存先を R2 にしないとき(R2 の利用を始めていない Cloudflare のアカウント)に、写真をデータベースに保存する表。
-- R2 を使うようになったら、この表は使われなくなる(中身は残る)。
CREATE TABLE IF NOT EXISTS media_objects (
  key TEXT PRIMARY KEY,
  bytes BLOB NOT NULL,
  content_type TEXT,
  size INTEGER NOT NULL,
  uploaded_at INTEGER NOT NULL
);
