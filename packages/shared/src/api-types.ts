import type { DogSex, DogSize, DogStatus, Neutered } from './constants';

// API の応答の型。画面と API で共有する。

export type MeUnregistered = {
  registered: false;
  lineDisplayName: string;
  terms: { termsText: string; privacyText: string };
};

export type MeRegistered = {
  registered: true;
  member: { id: number; lineDisplayName: string };
  household: { memberNo: string; displayName: string };
  /** 会員証(C-06) */
  card: MemberCard;
};

export type MemberCard = {
  dogs: DogSummary[];
  /** ポイント残高(台帳から計算) */
  balance: number;
  pointsPerTicket: number;
  /** 次の無料券まであと何ポイント */
  toNextTicket: number;
  /** 使える無料券 */
  tickets: { id: number; issuedAt: string; expiresAt: string | null }[];
  /** 今日のチェックイン(済んでいれば) */
  todayVisitId: number | null;
};

export type MeResponse = MeUnregistered | MeRegistered;

export type Breed = {
  id: number;
  name: string;
  defaultSize: DogSize;
  isOther: boolean;
};

export type DogSummary = {
  id: number;
  dogNo: string;
  name: string;
  breedId: number;
  /** 表示用の犬種(「その他」のときは自由入力の内容) */
  breedName: string;
  breedOther: string | null;
  size: DogSize;
  sex: DogSex | null;
  birthYm: string | null;
  neutered: Neutered | null;
  status: DogStatus;
  /** 写真(認証つき API の URL)。写真がなければ null */
  photoUrl: string | null;
  thumbUrl: string | null;
};

export type RegisterResponse = {
  memberNo: string;
  householdName: string;
  dogs: DogSummary[];
};

export type TodayVisit = {
  id: number;
  /** チェックインした家族の LINE の表示名 */
  checkedInBy: string;
  /** 自分がチェックインしたか */
  isMe: boolean;
  dogIds: number[];
  usedTicket: boolean;
};

/** チェックイン画面(L-05)の表示内容 */
export type CheckinStatus = {
  /** 日本時間の今日 */
  today: string;
  /** 今日すでにおうちの誰かがチェックインしていれば、その来場 */
  visit: TodayVisit | null;
  dogs: DogSummary[];
  balance: number;
  unusedTickets: number;
};

export type CheckinResult = {
  visitId: number;
  pointsAwarded: number;
  ticketsIssued: number;
  usedTicket: boolean;
  balanceAfter: number;
};

/** チェックイン完了画面(L-06)の表示内容(C-05) */
export type CheckinDetail = {
  visitId: number;
  memberNo: string;
  householdName: string;
  visitDate: string;
  checkedInAt: string;
  checkedInBy: string;
  /** 今日の来場か(前の日の画面は、受付で見せても使えない) */
  isToday: boolean;
  cancelled: boolean;
  dogs: DogSummary[];
  pointsAwarded: number;
  ticketsIssued: number;
  usedTicket: boolean;
  balance: number;
  unusedTickets: number;
  pointsPerTicket: number;
};

/** 作った招待(C-11) */
export type InviteCreated = {
  code: string;
  expiresAt: string;
};

/** 招待を開いたときの内容(C-12) */
export type InviteInfo = {
  /** valid: 使える / expired: 期限切れ / used: 使用済み */
  status: 'valid' | 'expired' | 'used';
  householdName: string;
  dogs: { id: number; name: string; breedName: string; thumbUrl: string | null }[];
  expiresAt: string;
  /** 開いた人の状態。new: まだ会員でない / member: すでにこのおうちの家族 / other: 別のおうちの家族 */
  viewer: 'new' | 'member' | 'other';
  /** はじめての人に聞く質問(家族一人ひとりへの質問だけ) */
  questions: import('./schemas/survey').SurveyQuestion[];
  terms: { termsText: string; privacyText: string } | null;
};

export type InviteAcceptResult =
  /** おうちに参加した */
  | { result: 'joined'; memberNo: string; householdName: string }
  /** 別のおうちがあるので、まとめる申請を作った(管理者の確認待ち) */
  | { result: 'requested' };

/** ログイン中の管理画面の利用者(S-01) */
export type StaffMe = {
  id: number;
  name: string;
  email: string;
  role: import('./constants').StaffRole;
};

/** 管理画面の来場の1行(S-02) */
export type AdminVisit = {
  id: number;
  /** 来場日(日本時間) */
  date: string;
  /** チェックインの時刻 "09:15" */
  time: string;
  householdId: number | null;
  memberNo: string | null;
  householdName: string | null;
  dogs: { id: number; name: string; breedName: string; thumbUrl: string | null }[];
  dogCount: number;
  usedTicket: boolean;
  method: import('./constants').VisitMethod;
  cancelled: boolean;
  cancelReason: string | null;
  /** チェックインした家族の LINE の表示名。管理者と製作者だけに返す(15.2) */
  checkedInBy: string | null;
};

export type TodayResponse = {
  date: string;
  visits: AdminVisit[];
  /** 取り消しを除いた集計 */
  totals: { groups: number; memberDogs: number; walkinDogs: number; ticketsUsed: number };
  /** 確認待ちの件数(管理者と製作者だけ) */
  pendingRequests: number | null;
};

/** おうちの検索結果の1件(S-06) */
export type HouseholdHit = {
  id: number;
  memberNo: string;
  displayName: string;
  status: import('./constants').HouseholdStatus;
  /** 統合済みのとき、統合先の会員ID(5.3) */
  mergedIntoMemberNo: string | null;
  dogs: { id: number; name: string; breedName: string; thumbUrl: string | null }[];
  /** 最後に来場した日 */
  lastVisit: string | null;
  /** 家族の LINE の表示名。管理者と製作者だけに返す(15.2) */
  familyNames: string[] | null;
};

export type HouseholdSearchResponse = {
  households: HouseholdHit[];
};
