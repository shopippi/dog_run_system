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
  ticket_issue: '無料券の発行',
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

export const SURVEY_KINDS = ['choice', 'text'] as const;
export type SurveyKind = (typeof SURVEY_KINDS)[number];

export const DAY_TYPES = ['weekday', 'saturday', 'sunday', 'holiday'] as const;
export type DayType = (typeof DAY_TYPES)[number];

export const ACTOR_TYPES = ['member', 'staff', 'system'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];
export type AuditActor = ActorType;

// 固定のアンケート(要件定義書 7.1)。選択肢の文言は survey_questions に入り、管理画面から変えられる。
// 回答は分析しやすいよう households / family_members の列に保存する。
export const FIXED_SURVEY_KEYS = ['age_group', 'gender', 'postal_code', 'referral', 'transport'] as const;
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
