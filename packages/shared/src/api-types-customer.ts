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
