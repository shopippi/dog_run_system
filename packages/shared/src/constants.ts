// データベースに保存する値と、画面に出す言葉の対応表。
// 保存する値は英語の短い記号、画面には日本語のラベルだけを出す(要件定義書 15.1)。

export const HOUSEHOLD_STATUSES = ['active', 'merged', 'withdrawn'] as const;
export type HouseholdStatus = (typeof HOUSEHOLD_STATUSES)[number];

export const HOUSEHOLD_SOURCES = ['new', 'migration'] as const;
export type HouseholdSource = (typeof HOUSEHOLD_SOURCES)[number];

export const MEMBER_STATUSES = ['active', 'left', 'withdrawn'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const JOIN_METHODS = ['register', 'invite', 'reception', 'merge'] as const;
export type JoinMethod = (typeof JOIN_METHODS)[number];
export const JOIN_METHOD_LABELS: Record<JoinMethod, string> = {
  register: 'はじめに登録',
  invite: '招待で参加',
  reception: '受付で参加',
  merge: 'おうちをまとめて参加',
};

export const INVITE_KINDS = ['family', 'reception'] as const;
export type InviteKind = (typeof INVITE_KINDS)[number];

export const DOG_STATUSES = ['active', 'retired', 'merged'] as const;
export type DogStatus = (typeof DOG_STATUSES)[number];

export const DOG_SIZES = ['small', 'medium', 'large'] as const;
export type DogSize = (typeof DOG_SIZES)[number];
export const DOG_SIZE_LABELS: Record<DogSize, string> = {
  small: '小型',
  medium: '中型',
  large: '大型',
};

export const DOG_SEXES = ['male', 'female'] as const;
export type DogSex = (typeof DOG_SEXES)[number];
export const DOG_SEX_LABELS: Record<DogSex, string> = {
  male: 'オス',
  female: 'メス',
};

export const VISIT_METHODS = ['self', 'proxy', 'walkin'] as const;
export type VisitMethod = (typeof VISIT_METHODS)[number];
export const VISIT_METHOD_LABELS: Record<VisitMethod, string> = {
  self: 'ご本人',
  proxy: '受付で代理',
  walkin: '会員以外',
};

export const LEDGER_KINDS = [
  'visit',
  'ticket_issue',
  'cancel',
  'migration',
  'manual',
  'merge',
  'expire',
] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];
export const LEDGER_KIND_LABELS: Record<LedgerKind, string> = {
  visit: '来場',
  ticket_issue: '無料券と交換',
  cancel: '来場の取り消し',
  migration: '旧カードから引き継ぎ',
  manual: '手動で調整',
  merge: 'おうちをまとめた',
  expire: '期限切れ',
};

export const TICKET_STATUSES = ['unused', 'used', 'expired', 'void'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  unused: '未使用',
  used: '使用済み',
  expired: '期限切れ',
  void: '取り消し',
};

export const REQUEST_KINDS = ['migration', 'merge'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const REQUEST_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const MIGRATION_SOURCES = ['line_card', 'paper_card'] as const;
export type MigrationSource = (typeof MIGRATION_SOURCES)[number];
export const MIGRATION_SOURCE_LABELS: Record<MigrationSource, string> = {
  line_card: 'LINEのショップカード',
  paper_card: '紙のスタンプカード',
};

export const STAFF_ROLES = ['staff', 'admin', 'developer'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  staff: '受付スタッフ',
  admin: '管理者',
  developer: '製作者(見るだけ)',
};

export const STAFF_STATUSES = ['active', 'suspended'] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

export const SURVEY_TARGETS = ['member', 'household'] as const;
export type SurveyTarget = (typeof SURVEY_TARGETS)[number];

/** 答え方: choice 1つ選ぶ / text 自由に書く / multi いくつでも選ぶ(複数選択) */
export const SURVEY_KINDS = ['choice', 'text', 'multi'] as const;
export type SurveyKind = (typeof SURVEY_KINDS)[number];

export const DAY_TYPES = ['weekday', 'saturday', 'sunday', 'holiday'] as const;
export type DayType = (typeof DAY_TYPES)[number];

export const ACTOR_TYPES = ['member', 'staff', 'system'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];
export type AuditActor = ActorType;

// 固定のアンケート(要件定義書 7.1)。選択肢の文言は survey_questions に入り、管理画面から変えられる。
// 回答は分析しやすいよう households / family_members の列に保存する。
export const FIXED_SURVEY_KEYS = [
  'age_group',
  'gender',
  'postal_code',
  'referral',
  'transport',
  // 2026-10-28 に足した、おうちへの任意の質問(担当J)
  'preferred_times',
  'event_interests',
  'uses_other_runs',
  'wants_news',
] as const;
export type FixedSurveyKey = (typeof FIXED_SURVEY_KEYS)[number];

export const AGE_GROUPS = ['10代', '20代', '30代', '40代', '50代', '60代', '70代以上'] as const;
export const GENDERS = ['女性', '男性', '答えない'] as const;
export const REFERRALS = [
  'Instagram',
  'Googleマップ',
  '知人の紹介',
  '通りがかり',
  'ほかのドッグランで聞いた',
  'その他',
] as const;
export const TRANSPORTS = ['車', '徒歩', '自転車', '電車やバス'] as const;

export const DOG_NAME_MAX = 20;

// 犬種の初期の選択肢(6.1、A-11)。大まかな分け方で、日本で多い順。「ミックス」「その他」が最後。
// apps/api/migrations/0001_init.sql の INSERT と同じ(id は入れる番号)。
export const INITIAL_BREEDS: readonly { id: number; name: string; defaultSize: DogSize; isOther: boolean }[] = [
  { id: 1, name: 'プードル', defaultSize: 'small', isOther: false },
  { id: 2, name: 'チワワ', defaultSize: 'small', isOther: false },
  { id: 3, name: 'ダックスフンド', defaultSize: 'small', isOther: false },
  { id: 4, name: 'ポメラニアン', defaultSize: 'small', isOther: false },
  { id: 5, name: '柴犬', defaultSize: 'medium', isOther: false },
  { id: 6, name: 'フレンチブルドッグ', defaultSize: 'medium', isOther: false },
  { id: 12, name: 'ミニチュアシュナウザー', defaultSize: 'small', isOther: false },
  { id: 13, name: 'ヨークシャーテリア', defaultSize: 'small', isOther: false },
  { id: 14, name: 'マルチーズ', defaultSize: 'small', isOther: false },
  { id: 15, name: 'シーズー', defaultSize: 'small', isOther: false },
  { id: 8, name: 'ゴールデンレトリバー', defaultSize: 'large', isOther: false },
  { id: 16, name: 'パピヨン', defaultSize: 'small', isOther: false },
  { id: 17, name: 'コーギー', defaultSize: 'medium', isOther: false },
  { id: 18, name: 'ジャックラッセルテリア', defaultSize: 'small', isOther: false },
  { id: 9, name: 'ラブラドールレトリバー', defaultSize: 'large', isOther: false },
  { id: 19, name: 'ペキニーズ', defaultSize: 'small', isOther: false },
  { id: 7, name: 'ボーダーコリー', defaultSize: 'medium', isOther: false },
  { id: 20, name: 'キャバリア', defaultSize: 'small', isOther: false },
  { id: 21, name: 'パグ', defaultSize: 'small', isOther: false },
  { id: 22, name: 'ビーグル', defaultSize: 'medium', isOther: false },
  { id: 23, name: 'ボストンテリア', defaultSize: 'small', isOther: false },
  { id: 24, name: 'ミニチュアピンシャー', defaultSize: 'small', isOther: false },
  { id: 25, name: 'イタリアングレーハウンド', defaultSize: 'small', isOther: false },
  { id: 26, name: 'バーニーズマウンテンドッグ', defaultSize: 'large', isOther: false },
  { id: 10, name: 'ミックス', defaultSize: 'small', isOther: false },
  { id: 11, name: 'その他', defaultSize: 'small', isOther: true },
];

/**
 * 細かい犬種名 → 大まかな犬種名。すでにあるデータベースの犬種を、0007_profile.sql でまとめたときの対応。
 * (例: ミニチュアダックスフンド・カニンヘンダックスフンド → ダックスフンド)
 */
export const BREED_GROUP_ALIASES: Readonly<Record<string, string>> = {
  'トイプードル': 'プードル',
  'ティーカッププードル': 'プードル',
  'タイニープードル': 'プードル',
  'ミニチュアプードル': 'プードル',
  'ミディアムプードル': 'プードル',
  'スタンダードプードル': 'プードル',
  'ロングコートチワワ': 'チワワ',
  'スムースコートチワワ': 'チワワ',
  'ミニチュアダックスフンド': 'ダックスフンド',
  'カニンヘンダックスフンド': 'ダックスフンド',
  'スタンダードダックスフンド': 'ダックスフンド',
  'ミニチュアダックス': 'ダックスフンド',
  'カニンヘンダックス': 'ダックスフンド',
  '豆柴': '柴犬',
  '豆柴犬': '柴犬',
  'フレンチ・ブルドッグ': 'フレンチブルドッグ',
  'フレンチブル': 'フレンチブルドッグ',
  'ミニチュア・シュナウザー': 'ミニチュアシュナウザー',
  'ヨークシャー・テリア': 'ヨークシャーテリア',
  'ヨーキー': 'ヨークシャーテリア',
  'シー・ズー': 'シーズー',
  'ゴールデン・レトリバー': 'ゴールデンレトリバー',
  'ゴールデンレトリーバー': 'ゴールデンレトリバー',
  'ゴールデン・レトリーバー': 'ゴールデンレトリバー',
  'ウェルシュコーギー': 'コーギー',
  'ウェルシュ・コーギー': 'コーギー',
  'ウェルシュコーギーペンブローク': 'コーギー',
  'ウェルシュコーギー・ペンブローク': 'コーギー',
  'ウェルシュ・コーギー・ペンブローク': 'コーギー',
  'ジャック・ラッセル・テリア': 'ジャックラッセルテリア',
  'ラブラドール・レトリバー': 'ラブラドールレトリバー',
  'ラブラドールレトリーバー': 'ラブラドールレトリバー',
  'ラブラドール・レトリーバー': 'ラブラドールレトリバー',
  'ボーダー・コリー': 'ボーダーコリー',
  'キャバリアキングチャールズスパニエル': 'キャバリア',
  'キャバリア・キング・チャールズ・スパニエル': 'キャバリア',
  'ボストン・テリア': 'ボストンテリア',
  'ミニチュア・ピンシャー': 'ミニチュアピンシャー',
  'ミニピン': 'ミニチュアピンシャー',
  'イタリアン・グレーハウンド': 'イタリアングレーハウンド',
  'イタグレ': 'イタリアングレーハウンド',
  'バーニーズ・マウンテン・ドッグ': 'バーニーズマウンテンドッグ',
  'バーニーズ': 'バーニーズマウンテンドッグ',
  '雑種': 'ミックス',
  'MIX': 'ミックス',
};

// ---------------------------------------------------------------
// 飼い主とワンちゃんの情報(2026-10-28 に足した項目。要件定義書 6.1・7.1、担当J)
// ---------------------------------------------------------------

/** 来たい時間帯(おうち・任意・複数選択) */
export const PREFERRED_TIMES = ['平日の昼', '平日の夕方', '土日の午前', '土日の午後'] as const;
/** 興味のあるイベント(おうち・任意・複数選択) */
export const EVENT_INTERESTS = ['しつけ教室', '写真撮影会', '季節のイベント', '犬種別の集まり', '健康・ケアの相談'] as const;
/** はい・いいえで答える固定の質問の選択肢。households には 1(はい)/ 0(いいえ)で入れる */
export const YES_NO = ['はい', 'いいえ'] as const;
/** はい・いいえで答える固定の質問(選択肢は変えられない) */
export const YES_NO_SURVEY_KEYS = ['uses_other_runs', 'wants_news'] as const;
/** いくつでも選ぶ固定の質問(households に JSON の配列で入れる) */
export const MULTI_SURVEY_KEYS = ['preferred_times', 'event_interests'] as const;

/** ほかの犬との相性(ワンちゃん・任意)。小型犬だけの時間帯などの運営に使う */
export const DOG_SOCIABILITY = ['good', 'normal', 'shy'] as const;
export type DogSociability = (typeof DOG_SOCIABILITY)[number];
export const DOG_SOCIABILITY_LABELS: Record<DogSociability, string> = {
  good: '得意',
  normal: 'ふつう',
  shy: '苦手',
};

/** ワンちゃんの体重(kg、小数1桁) */
export const DOG_WEIGHT_MIN = 0.1;
export const DOG_WEIGHT_MAX = 100;
/** 予防注射・ワクチンの年の最初(最後は今年) */
export const VACCINE_YEAR_MIN = 2000;
