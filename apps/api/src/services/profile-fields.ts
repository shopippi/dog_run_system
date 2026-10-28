import {
  MULTI_SURVEY_KEYS,
  YES_NO,
  YES_NO_SURVEY_KEYS,
  decodeMultiAnswer,
  type FixedSurveyKey,
  type SurveyAnswerValue,
} from '@dr/shared';

// 固定の質問の回答を入れている列と、列の値の形(担当J。要件定義書 7.1)。
// - 年代・性別は家族(family_members)の列、それ以外はおうち(households)の列
// - 来たい時間帯・興味のあるイベントは JSON の配列、ほかのドッグラン・お知らせは 1(はい)/ 0(いいえ)

export const MEMBER_FIXED_COLUMNS: Partial<Record<FixedSurveyKey, string>> = { age_group: 'age_group', gender: 'gender' };

export const HOUSEHOLD_FIXED_COLUMNS: Partial<Record<FixedSurveyKey, string>> = {
  postal_code: 'postal_code',
  referral: 'referral',
  transport: 'transport',
  preferred_times: 'preferred_times',
  event_interests: 'event_interests',
  uses_other_runs: 'uses_other_runs',
  wants_news: 'wants_news',
};

/** おうちの列の一覧(SELECT に使う) */
export const HOUSEHOLD_PROFILE_SELECT = Object.values(HOUSEHOLD_FIXED_COLUMNS).join(', ');

export type HouseholdProfileRow = Record<string, string | number | null>;

const isYesNo = (key: string): boolean => (YES_NO_SURVEY_KEYS as readonly string[]).includes(key);
const isMulti = (key: string): boolean => (MULTI_SURVEY_KEYS as readonly string[]).includes(key);

/**
 * 確かめた回答(checkSurveyAnswers の値。複数選択は JSON の配列の文字)を、列に入れる値にする。
 * はい・いいえは 1 / 0 にする。
 */
export function toHouseholdColumnValue(key: FixedSurveyKey, value: string | null): string | number | null {
  if (value === null) return null;
  if (isYesNo(key)) return value === YES_NO[0] ? 1 : value === YES_NO[1] ? 0 : null;
  return value;
}

/** 列の値を、回答の形(選択肢の文字・複数選択は配列)にする。お客さんのプロフィールと管理画面の入力に使う */
export function fromHouseholdColumnValue(key: FixedSurveyKey, stored: string | number | null | undefined): SurveyAnswerValue {
  if (stored === null || stored === undefined || stored === '') return null;
  if (isYesNo(key)) return Number(stored) === 1 ? YES_NO[0] : YES_NO[1];
  if (isMulti(key)) {
    const list = decodeMultiAnswer(String(stored));
    return list.length ? list : null;
  }
  return String(stored);
}

/** 列の値を、画面と CSV に出す文にする(複数選択は「・」でつなぐ) */
export function householdColumnText(key: FixedSurveyKey, stored: string | number | null | undefined): string | null {
  const v = fromHouseholdColumnValue(key, stored);
  if (v === null) return null;
  return Array.isArray(v) ? v.join('・') : v;
}
