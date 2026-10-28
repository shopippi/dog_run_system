// API の応答の型(settings)。ルールの設定(A-12)・犬種(A-11)・アンケート(A-10)・スタッフ(A-13)・
// イベントと休業日(A-09)・使い方(A-16)。
import type { Settings } from './settings';

/** ルールの設定(GET / PATCH /admin/api/settings) */
export type SettingsResponse = {
  settings: Settings;
  /** 受付の固定QRコードに入れる URL(LINEミニアプリの番号がなければ /liff/ から始まる相対 URL) */
  checkinUrl: string;
};


/** 管理画面の犬種の選択肢(A-11) */
export type AdminBreed = {
  id: number;
  name: string;
  defaultSize: import('./constants').DogSize;
  /** お客さんの選択肢に出すか */
  visible: boolean;
  /** 「その他」(自由入力)。消せず、常に最後 */
  isOther: boolean;
  /** この犬種で登録されている犬の数(登録解除・統合済みを除く) */
  dogCount: number;
};

export type AdminBreedsResponse = { breeds: AdminBreed[] };
