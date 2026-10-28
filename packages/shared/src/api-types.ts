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
