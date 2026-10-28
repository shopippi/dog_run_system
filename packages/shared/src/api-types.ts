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
