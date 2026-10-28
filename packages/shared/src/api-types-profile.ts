// API の応答の型と、画面に出す言葉(profile: 飼い主とワンちゃんの情報、犬種の分け方。担当J)。
import { DOG_FIELD_LABELS, AUDIT_ACTION_LABELS } from './api-types-households';

// 操作ログ(A-15)の言葉。ほかの担当の表とぶつからないよう、ここから足す
Object.assign(AUDIT_ACTION_LABELS, {
  'breed.consolidate': '犬種を大まかな分け方にまとめた',
  'household.profile': 'おうちのアンケートの回答の変更',
});

// 犬の変更履歴(dog_changes.field)の言葉。2026-10-28 に足した項目
Object.assign(DOG_FIELD_LABELS, {
  weight_kg: '体重',
  sociability: 'ほかの犬との相性',
  rabies_vaccine_year: '狂犬病の予防注射',
  combo_vaccine_year: '混合ワクチン',
});

/**
 * おうちへのアンケート(固定の質問)の、いまの回答。管理者がおうちの詳細(M-06)で変えるときに使う。
 * GET・PATCH /admin/api/households/:id/profile の応答。
 */
export type HouseholdProfileResponse = {
  /** おうちへの固定の質問(郵便番号・きっかけ・来場手段・来たい時間帯・興味のあるイベント・ほかのドッグラン・お知らせ) */
  questions: import('./schemas/survey').SurveyQuestion[];
  answers: { questionId: number; value: import('./schemas/survey').SurveyAnswerValue }[];
};

/** 体重の表示(5.2kg) */
export const formatWeight = (kg: number | null | undefined) => (kg == null ? null : `${kg.toFixed(1)}kg`);
