// API の応答の型と、画面に出す言葉(households: おうちの詳細と記録、操作ログ)。

// ============================================================
// A-15 操作ログ
// ============================================================

/**
 * 操作の種類(audit_log.action)と、画面に出す言葉。action の記号は画面に出さない(15.1)。
 * 新しい操作を記録するときは、ここに言葉を足す(足さなければ「そのほかの変更」と出る)。
 */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'visit.cancel': 'チェックインの取り消し',
  'visit.proxy': '代理チェックイン',
  'visit.walkin': '会員以外の記録',
  'audit.undo': '元に戻す',
  'household.rename': 'おうちの呼び名の変更',
  'points.manual': 'ポイント・無料券の手動登録',
  'dog.update': 'ワンちゃんの情報の変更',
  'dog.photo': 'ワンちゃんの写真の差し替え',
  'dog.photo_rotate': 'ワンちゃんの写真の回転',
  'dog.photo_remove': 'ワンちゃんの写真の削除',
  'family.invite': '受付での家族の招待',
  'family.remove': '家族を外す',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? 'そのほかの変更';
}

/** 操作ログの1行(M-15) */
export type AuditEntry = {
  id: number;
  /** 操作した日時(日本時間) */
  at: string;
  /** 誰が(スタッフの名前。お客さん本人や自動処理のときはその旨) */
  actorName: string;
  /** 何を(操作の種類の言葉) */
  actionLabel: string;
  /** 対象。名前と、会員ID・犬ID(code)で分かるようにする */
  target: { label: string; code: string | null; householdId: number | null };
  /** 変更の中身の短い説明(「「アルのおうち」→「アルくんのおうち」」など) */
  detail: string | null;
  reason: string | null;
  /** 「元に戻す」を出してよいか */
  canUndo: boolean;
  /** 元に戻し済みなら、いつ・誰が */
  undone: { at: string; byName: string } | null;
};

export type AuditListResponse = {
  entries: AuditEntry[];
  page: number;
  pageSize: number;
  total: number;
  /** 絞り込みに使える操作の種類(value は送り返すだけで、画面には label を出す) */
  actions: { value: string; label: string }[];
};

// ============================================================
// A-02 おうちの詳細
// ============================================================

export const HOUSEHOLD_STATUS_LABELS: Record<import('./constants').HouseholdStatus, string> = {
  active: '利用中',
  merged: '統合済み',
  withdrawn: '退会',
};

export const HOUSEHOLD_SOURCE_LABELS: Record<import('./constants').HouseholdSource, string> = {
  new: '新規の登録',
  migration: '旧カードから移行',
};

export const MEMBER_STATUS_LABELS: Record<import('./constants').MemberStatus, string> = {
  active: '参加中',
  left: '外れた',
  withdrawn: '退会',
};

export const DOG_STATUS_LABELS: Record<import('./constants').DogStatus, string> = {
  active: '登録中',
  retired: '登録解除',
  merged: '統合済み',
};

export const TICKET_SOURCE_LABELS: Record<'points' | 'manual' | 'merge' | 'migration', string> = {
  points: 'ポイントがたまって発行',
  manual: '手動で追加',
  merge: 'おうちの統合',
  migration: '旧カードから移行',
};

/** おうちの家族(LINE アカウント) */
export type HouseholdFamilyMember = {
  id: number;
  /** LINE の表示名(退会で消えていれば null) */
  name: string | null;
  /** 年代・性別(管理者と製作者だけ。それ以外は null) */
  ageGroup: string | null;
  gender: string | null;
  joinMethodLabel: string;
  joinedAt: string;
  status: import('./constants').MemberStatus;
  statusLabel: string;
  leftAt: string | null;
};

/** 来場履歴の1行 */
export type HouseholdVisit = {
  id: number;
  date: string;
  time: string;
  dogs: { id: number; name: string }[];
  /** チェックインした家族の LINE の表示名(受付の代理なら null) */
  checkedInBy: string | null;
  methodLabel: string;
  /** その来場で付いたポイント */
  points: number;
  usedTicket: boolean;
  cancelled: boolean;
  cancelReason: string | null;
};

/** ポイントの記録(台帳)の1行 */
export type HouseholdLedgerEntry = {
  id: number;
  at: string;
  delta: number;
  kindLabel: string;
  reason: string | null;
  actorName: string | null;
};

export type HouseholdTicket = {
  id: number;
  issuedAt: string;
  expiresAt: string | null;
  status: import('./constants').TicketStatus;
  statusLabel: string;
  sourceLabel: string;
  usedAt: string | null;
};

export type SurveyAnswerView = { label: string; answer: string | null };

/** おうちの詳細(M-06、A-02) */
export type HouseholdDetail = {
  id: number;
  memberNo: string;
  displayName: string;
  /** 呼び名を犬の名前から自動で作っているか */
  displayNameAuto: boolean;
  registeredAt: string;
  status: import('./constants').HouseholdStatus;
  statusLabel: string;
  sourceLabel: string;
  /** 統合済みのとき、統合先 */
  mergedInto: { id: number; memberNo: string; displayName: string } | null;
  balance: number;
  /** 使える無料券の枚数 */
  usableTickets: number;
  pointsPerTicket: number;
  toNextTicket: number;
  /** 来場の回数(取り消しを除く) */
  visitCount: number;
  family: HouseholdFamilyMember[];
  /** 犬(登録解除した犬も含む) */
  dogs: import('./api-types').DogSummary[];
  /** 来場履歴(新しい順。最大100件) */
  visits: HouseholdVisit[];
  /** ポイントの記録(新しい順。最大200件) */
  ledger: HouseholdLedgerEntry[];
  tickets: HouseholdTicket[];
  /** アンケートの回答(管理者と製作者だけ。それ以外は null) */
  survey: {
    household: SurveyAnswerView[];
    members: { memberId: number; name: string | null; answers: SurveyAnswerView[] }[];
  } | null;
};

// ============================================================
// A-03 ポイントの手動登録
// ============================================================

/** 手動の登録の結果(確定の前に見せるプレビューと、確定した結果) */
export type ManualPointsPreview = {
  balanceBefore: number;
  balanceAfter: number;
  ticketsBefore: number;
  ticketsAfter: number;
  /** ポイントがたまって発行する無料券 */
  ticketsIssued: number;
  pointsPerTicket: number;
};

// ============================================================
// A-04 犬の情報の変更
// ============================================================

/** 犬の変更履歴の項目(dog_changes.field)の言葉 */
export const DOG_FIELD_LABELS: Record<string, string> = {
  name: '名前',
  breed: '犬種',
  size: 'サイズ',
  sex: '性別',
  birth_ym: '生まれた年月',
  status: '登録の状態',
  photo: '写真',
};

/** 犬の変更履歴の1行 */
export type DogChangeEntry = {
  id: number;
  at: string;
  fieldLabel: string;
  /** 画面に出す形にした変更前・変更後 */
  before: string | null;
  after: string | null;
  reason: string | null;
  /** 変えた人(スタッフの名前、またはお客さん) */
  actorName: string;
};

/** 犬の編集画面(M-07)の内容 */
export type AdminDogDetail = {
  dog: import('./api-types').DogSummary;
  household: { id: number; memberNo: string; displayName: string; status: import('./constants').HouseholdStatus };
  /** 選べる犬種(表示しない犬種でも、今の犬種は含める) */
  breeds: import('./api-types').Breed[];
  /** 変更の履歴(新しい順) */
  changes: DogChangeEntry[];
};

// ============================================================
// A-06 家族の追加・解除
// ============================================================

/** 受付で出す家族の招待QR(5.2) */
export type ReceptionInvite = {
  code: string;
  /** QR に入れる URL。LIFF ID が設定されていれば https://liff.line.me/<LIFF ID>/invite/<code>、なければ /liff/invite/<code> */
  url: string;
  expiresAt: string;
  ttlMinutes: number;
};
