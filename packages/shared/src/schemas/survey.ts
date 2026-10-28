import { z } from 'zod';
import type { FixedSurveyKey, SurveyKind, SurveyTarget } from '../constants';

// アンケート(要件定義書 7章)。固定の質問と、管理者が追加した質問を同じ形で扱う。

export type SurveyQuestion = {
  id: number;
  /** 固定の質問のキー。管理者が追加した質問は null */
  fixedKey: FixedSurveyKey | null;
  /** 聞く相手(家族一人ひとり / おうち) */
  target: SurveyTarget;
  kind: SurveyKind;
  label: string;
  options: string[];
  required: boolean;
};

export const SURVEY_TEXT_MAX = 200;

export const surveyAnswersSchema = z
  .array(
    z.object({
      questionId: z.number().int().positive(),
      /** null は「答えない」 */
      value: z.string().trim().max(SURVEY_TEXT_MAX, { error: `回答は${SURVEY_TEXT_MAX}文字までで入力してください。` }).nullable(),
    }),
  )
  .max(100);
export type SurveyAnswerInput = z.infer<typeof surveyAnswersSchema>[number];

/** 郵便番号を7桁の数字にそろえる。空なら null、形が違えば undefined。 */
export function normalizePostalCode(input: string | null | undefined): string | null | undefined {
  if (input == null) return null;
  const digits = input.normalize('NFKC').replace(/[\s〒ー−‐-]/g, '');
  if (digits === '') return null;
  return /^\d{7}$/.test(digits) ? digits : undefined;
}

export type CheckedAnswers = { ok: true; values: Map<number, string | null> } | { ok: false; message: string };

/**
 * 回答を確かめる。画面と API で同じ確認をする。
 * enforceRequired が false のとき(登録後に1回だけ出す質問)は、すべて「答えない」でもよい(7.2)。
 */
export function checkSurveyAnswers(
  questions: SurveyQuestion[],
  answers: SurveyAnswerInput[],
  enforceRequired: boolean,
): CheckedAnswers {
  const given = new Map(answers.map((a) => [a.questionId, a.value]));
  const values = new Map<number, string | null>();
  for (const q of questions) {
    let v = given.get(q.id) ?? null;
    if (v !== null && v.trim() === '') v = null;
    if (v === null) {
      if (enforceRequired && q.required) return { ok: false, message: `「${q.label}」に答えてください。` };
      values.set(q.id, null);
      continue;
    }
    if (q.fixedKey === 'postal_code') {
      const pc = normalizePostalCode(v);
      if (pc === undefined) return { ok: false, message: '郵便番号は7桁の数字で入力してください(例: 1234567)。' };
      values.set(q.id, pc);
      continue;
    }
    if (q.kind === 'choice' && !q.options.includes(v)) {
      return { ok: false, message: `「${q.label}」の選択肢が変わりました。画面を読み込み直して、選び直してください。` };
    }
    values.set(q.id, v);
  }
  return { ok: true, values };
}
