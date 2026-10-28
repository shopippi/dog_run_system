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

/** 管理画面のアンケートの質問(A-10) */
export type AdminSurveyQuestion = {
  id: number;
  /** 固定の質問のキー。管理者が追加した質問は null */
  fixedKey: string | null;
  /** 固定の質問(文と選択肢だけ変えられる。非表示にできない) */
  isFixed: boolean;
  target: import('./constants').SurveyTarget;
  kind: import('./constants').SurveyKind;
  label: string;
  options: string[];
  required: boolean;
  visible: boolean;
  /** 追加した質問の回答の数(「答えない」を除く)。固定の質問は null */
  answerCount: number | null;
};

export type AdminSurveyQuestionsResponse = { questions: AdminSurveyQuestion[] };

/** 追加した質問の回答の集計(GET /admin/api/survey-questions/:id/summary) */
export type SurveySummary = {
  question: AdminSurveyQuestion;
  /** 答えた数(「答えない」を除く) */
  answered: number;
  /** 「答えない」を選んだ数 */
  skipped: number;
  /** 選択肢ごとの数。今の選択肢にない回答(選択肢を変える前の回答)は current: false */
  counts: { option: string; count: number; current: boolean }[];
  /** 自由に書く質問の回答(新しい順に50件まで) */
  texts: { answer: string; answeredAt: string }[];
};
