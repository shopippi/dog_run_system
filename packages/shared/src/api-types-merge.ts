import type { DogSex, DogSize, HouseholdStatus, JoinMethod } from './constants';

// API の応答の型(merge)。おうちの統合(A-07)・確認待ち(A-08)・旧カードの移行(A-05)

/** 統合の画面に出す犬 */
export type MergeDogView = {
  id: number;
  dogNo: string;
  name: string;
  breedName: string;
  size: DogSize;
  sex: DogSex | null;
  birthYm: string | null;
  photoUrl: string | null;
  thumbUrl: string | null;
};

export type MergeFamilyView = { id: number; name: string; joinMethod: JoinMethod };

/** 統合の画面に出すおうち(統合前) */
export type MergeHouseholdView = {
  id: number;
  memberNo: string;
  displayName: string;
  status: HouseholdStatus;
  registeredAt: string;
  family: MergeFamilyView[];
  dogs: MergeDogView[];
  points: number;
  /** 使える無料券の枚数 */
  tickets: number;
  /** 来場の回数(取り消しを除く) */
  visits: number;
  lastVisit: string | null;
};

/** 統合の確認(POST /admin/api/merges/preview) */
export type MergePreview = {
  kept: MergeHouseholdView;
  absorbed: MergeHouseholdView;
  /** 残す会員IDの初期値(登録が古い方) */
  suggestedKeepHouseholdId: number;
  result: {
    memberNo: string;
    displayName: string;
    family: MergeFamilyView[];
    /** mergedFromId: 組み合わせて1頭にした、まとめる側の犬 */
    dogs: (MergeDogView & { mergedFromId: number | null })[];
    points: number;
    tickets: number;
    /** 合算で新しく発行する無料券 */
    ticketsIssued: number;
    visits: number;
  };
  /** 両方のおうちが来場していた日。どちらの来場も記録に残す */
  sameDayVisitDates: string[];
  /** その日の分として差し引くポイント(初期設定では 0 = 減らさない) */
  sameDayPointsRemoved: number;
};

/** 統合の実行(POST /admin/api/merges) */
export type MergeResult = {
  mergeId: number;
  memberNo: string;
  displayName: string;
  points: number;
  tickets: number;
  ticketsIssued: number;
  /** 元に戻せる期限 */
  undoDeadline: string;
};

/** 統合の記録(GET /admin/api/merges/:id、GET /admin/api/merges?householdId=) */
export type MergeRecord = {
  id: number;
  kept: { id: number; memberNo: string; displayName: string };
  absorbed: { id: number; memberNo: string; displayName: string };
  executedAt: string;
  executedBy: string;
  undoneAt: string | null;
  undoDeadline: string;
  /** ok: 元に戻せる / undone: 戻した / expired: 30日を過ぎた / changed: 統合後に来場・ポイントの変更がある */
  undoStatus: 'ok' | 'undone' | 'expired' | 'changed';
};

/**
 * 旧カードの引き継ぎ申請(C-10)で requests.payload に入れる内容(kind = 'migration')。
 * 旧カードの写真は requests.attachment_key(R2 の requests/... のキー)。
 * C-10 の画面と API(担当E)はこの形で作り、承認(A-05)はこの形を読む。
 */
export type MigrationRequestPayload = {
  source: import('./constants').MigrationSource;
  /** お客さんが申請したポイント数(管理者が写真を見て確認・修正する) */
  claimedPoints: number;
  note?: string;
};

/** 確認待ちの一覧に出すおうち */
export type RequestHousehold = {
  id: number;
  memberNo: string;
  displayName: string;
  status: HouseholdStatus;
  /** 統合済みのとき、統合先の会員ID */
  mergedIntoMemberNo: string | null;
  dogs: { id: number; name: string; breedName: string; thumbUrl: string | null }[];
};

/** 確認待ちの1件(GET /admin/api/requests) */
export type RequestItem = {
  id: number;
  kind: import('./constants').RequestKind;
  status: import('./constants').RequestStatus;
  createdAt: string;
  /** 申請したおうち */
  household: RequestHousehold;
  /** まとめる相手のおうち(まとめる申請のとき) */
  related: RequestHousehold | null;
  /** 申請した家族の LINE の表示名 */
  requester: string | null;
  /** 旧カードの引き継ぎ申請の内容 */
  migration: MigrationRequestPayload | null;
  /** 添付画像(旧カードの写真)。削除済みなら null */
  attachmentUrl: string | null;
  handledAt: string | null;
  handledBy: string | null;
  handleNote: string | null;
};

export type RequestListResponse = {
  requests: RequestItem[];
  /** 確認待ちの件数(タブの印) */
  pending: number;
};
