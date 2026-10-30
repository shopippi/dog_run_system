// API の応答の型(customer)。お客さん向けの残りの機能(C-07・C-09・C-13)。C-10 旧カードの引き継ぎ申請はやめた(16.1)

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


// ---------------------------------------------------------------
// 前のカード(旧カード)からの引き継ぎ(16章)。お客さんへの案内と、引き継いだ記録
// ---------------------------------------------------------------

/** 引き継いだ記録の1件(お客さん向け) */
export type OldCardTransfer = {
  source: import('./constants').MigrationSource;
  /** 引き継いだポイント */
  points: number;
  /** 旧カードの特典から出した無料券の枚数 */
  tickets: number;
  /** 引き継いだ日時(日本時間) */
  at: string;
};

/** GET /api/me/oldcard */
export type OldCardResponse = {
  /** 会員証に出す案内。出さないときは null(引き継ぎ済み・移行期間の外・閉じた) */
  notice: { endDate: string | null } | null;
  /** 引き継いだ記録(新しい順。元に戻したものは除く。統合でまとめたおうちの分を含む) */
  transfers: OldCardTransfer[];
};
