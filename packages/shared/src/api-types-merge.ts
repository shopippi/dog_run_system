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
