// API の応答の型(customer)。お客さん向けの残りの機能(C-07・C-09・C-10・C-13)
import type { MigrationSource, RequestStatus } from './constants';

// ---------------------------------------------------------------
// C-10 旧カードの引き継ぎ申請
// ---------------------------------------------------------------

/**
 * 旧カードの引き継ぎ申請の内容(requests.payload の JSON。kind = 'migration')。
 * お客さんの申請(C-10)と、管理者の承認・却下(A-05)で同じ形を使う。
 */
export type MigrationRequestPayload = {
  /** 移行元(LINEのショップカード / 紙のスタンプカード) */
  source: MigrationSource;
  /** お客さんが申告した、だいたいのポイント数(0〜99)。分からなければ null */
  claimedPoints: number | null;
  /** お客さんのメモ */
  note: string | null;
};

/** お客さんに見せる、引き継ぎ申請の1件 */
export type MigrationRequestItem = {
  id: number;
  source: MigrationSource;
  claimedPoints: number | null;
  note: string | null;
  status: RequestStatus;
  /** 申請した日時(日本時間) */
  createdAt: string;
  /** 確認した日時(確認待ちのときは null) */
  handledAt: string | null;
};

/** 移行元ごとの状態。画面で「申請できるか」を決めるのに使う */
export type MigrationSourceState = {
  source: MigrationSource;
  /**
   * none: まだ引き継いでいない(申請できる)
   * pending: 申請して確認待ち
   * done: 引き継ぎ済み(申請の承認、または受付での直接入力)
   */
  state: 'none' | 'pending' | 'done';
  /** 引き継いだポイント(台帳の「旧カードから引き継ぎ」の合計)。引き継ぎ前は null */
  migratedPoints: number | null;
};

/** GET /api/requests の応答 */
export type MigrationRequestsResponse = {
  /** 申請の一覧(新しい順) */
  requests: MigrationRequestItem[];
  sources: MigrationSourceState[];
  /** 移行期間(未設定なら null)と、今日が受付期間の中か。notStarted は期間がまだ始まっていないとき */
  period: { start: string | null; end: string | null; open: boolean; notStarted: boolean };
};

// ---------------------------------------------------------------
// C-07 来場履歴
// ---------------------------------------------------------------

/** 来場履歴の1件(L-08) */
export type HistoryVisit = {
  id: number;
  /** 来場日(日本時間) */
  date: string;
  /** チェックインの時刻 "09:15" */
  time: string;
  /** 来た犬(統合で1頭にまとめた犬は、まとめた後の犬で返す) */
  dogs: { id: number; name: string; breedName: string; thumbUrl: string | null }[];
  /** チェックインした家族の LINE の表示名。受付での代理や、抜けた家族の名前が分からないときは null */
  checkedInBy: string | null;
  /** 自分がチェックインしたか */
  checkedInByMe: boolean;
  method: import('./constants').VisitMethod;
  /** この来場で付いたポイント */
  pointsAwarded: number;
  /** この来場でポイントがたまって発行された無料券の枚数(取り消しで回収されたものは数えない) */
  ticketsIssued: number;
  usedTicket: boolean;
  cancelled: boolean;
};

/** GET /api/me/visits の応答。next は次のページを読むときに before に渡す(最後のページなら null) */
export type VisitHistoryResponse = {
  visits: HistoryVisit[];
  next: string | null;
};

/** 来場履歴の1ページの件数 */
export const VISIT_HISTORY_PAGE_SIZE = 20;

// ---------------------------------------------------------------
// C-09 プロフィール
// ---------------------------------------------------------------

/** GET /api/me/profile・PATCH /api/me/profile の応答(L-10) */
export type ProfileResponse = {
  /** 表示している質問(並び順どおり)。家族一人ひとりへの質問と、おうちへの質問 */
  questions: import('./schemas/survey').SurveyQuestion[];
  /** いまの回答。家族向けは自分の回答、おうち向けはおうちの回答(最初の1人や家族が答えたもの) */
  /** いくつでも選ぶ質問(multi)は、選んだ選択肢の配列 */
  answers: { questionId: number; value: import('./schemas/survey').SurveyAnswerValue }[];
};

// ---------------------------------------------------------------
// C-13 家族の一覧と、自分が抜ける
// ---------------------------------------------------------------

/** おうちの家族の1人(L-11) */
export type FamilyMemberItem = {
  id: number;
  /** LINE の表示名。分からないときは null */
  name: string | null;
  /** 自分かどうか */
  isMe: boolean;
  /** 参加した日時(日本時間) */
  joinedAt: string;
  joinMethod: import('./constants').JoinMethod;
};

/** GET /api/family の応答 */
export type FamilyResponse = { members: FamilyMemberItem[] };

