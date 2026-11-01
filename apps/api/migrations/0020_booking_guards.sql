-- 予約の見張りを足す(2026-10-31 の見直し)
-- 1) 同じワンちゃんの予約が重ならないための見張り(1行だけ)。予約を入れる・元に戻す batch の最後で、
--    そのワンちゃんにほかの重なる予約(確認待ち・確定・お預かり中・利用済み)があれば CHECK で batch 全体を取り消す
CREATE TABLE booking_dog_guard (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL DEFAULT 0,
  dog_ok INTEGER NOT NULL DEFAULT 1 CHECK (dog_ok = 1)
);
INSERT INTO booking_dog_guard (id, version, dog_ok) VALUES (1, 0, 1);

-- 2) お客さんの送信の印(LINE ユーザーのハッシュ + 送信の印)。予約は入ったのに応答が届かず送り直したとき、同じ予約を返すため
ALTER TABLE bookings ADD COLUMN request_key TEXT;
CREATE UNIQUE INDEX uq_bookings_request_key ON bookings(request_key) WHERE request_key IS NOT NULL;
