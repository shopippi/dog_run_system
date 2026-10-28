// デモの「打ち合わせ用の手順」で使う、固定のおうちと LINE のアカウント。
// 会員ID(DR-000001 など)は初期データで必ずこの番号になる。

export type DemoAccount = {
  /** LINE のユーザーID(モック) */
  userId: string;
  /** LINE の表示名 */
  name: string;
  /** 画面に出す説明 */
  note: string;
};

export const ACCOUNTS: DemoAccount[] = [
  { userId: 'U-demo-mama', name: 'こむぎママ', note: 'こむぎ・だいずのおうち(9ポイント)' },
  { userId: 'U-demo-papa', name: 'こむぎパパ', note: 'まだ会員ではない(ママから招待される)' },
  { userId: 'U-demo-baaba', name: 'こむぎのばあば', note: 'こむぎ・だいずのおうちの家族' },
  { userId: 'U-demo-taka', name: 'taka_papa', note: 'アルのおうち(7ポイント)' },
  { userId: 'U-demo-nico', name: 'nico.mama', note: 'アル・ニコのおうち(5ポイント)' },
  { userId: 'U-demo-momo', name: 'ももママ', note: 'もものおうち(紙のスタンプカードを持っている)' },
  { userId: 'U-demo-new-1', name: 'はじめての人', note: 'まだ会員ではない' },
];

/** 手順で使うおうち(households.id = 会員IDの番号) */
export const FIXED = {
  komugi: 1, // 9ポイント。ママとばあばの2人
  taka: 2, // アル。7ポイント
  nico: 3, // アル・ニコ。5ポイント。taka とまとめる申請が確認待ち
  momo: 4, // 紙のスタンプカードを受付で見せる(旧カードの引き継ぎ)
} as const;

export const STAFF = [
  { email: 'staff@example.com', name: '佐藤', role: 'staff' as const, label: '受付スタッフ' },
  { email: 'admin@example.com', name: '田中', role: 'admin' as const, label: '管理者' },
  { email: 'developer@example.com', name: '山本', role: 'developer' as const, label: '製作者' },
];

export const DEMO_PASSWORD = 'demo-password-1234';
