// API の応答の型と、画面に出す言葉(profile: 飼い主とワンちゃんの情報、犬種の分け方。担当J)。
import { AUDIT_ACTION_LABELS } from './api-types-households';

// 操作ログ(A-15)の言葉。ほかの担当の表とぶつからないよう、ここから足す
Object.assign(AUDIT_ACTION_LABELS, {
  'breed.consolidate': '犬種を大まかな分け方にまとめた',
});
