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

/** 1つの回答。いくつでも選ぶ質問(multi)は、選んだ選択肢の配列 */
export type SurveyAnswerValue = string | string[] | null;

export const surveyAnswersSchema = z
  .array(
    z.object({
      questionId: z.number().int().positive(),
      /** null は「答えない」。いくつでも選ぶ質問(multi)は選んだ選択肢の配列(空の配列も「答えない」) */
      value: z
        .union([
          z.string().trim().max(SURVEY_TEXT_MAX, { error: `回答は${SURVEY_TEXT_MAX}文字までで入力してください。` }),
          z.array(z.string().trim().max(SURVEY_TEXT_MAX)).max(30),
        ])
        .nullable(),
    }),
  )
  .max(100);
export type SurveyAnswerInput = z.infer<typeof surveyAnswersSchema>[number];

/**
 * いくつでも選ぶ質問の回答を、保存する形(選択肢の順に並べた JSON の配列)にする。何も選んでいなければ null。
 * survey_answers.answer と households の列(来たい時間帯など)は、この形で入れる。
 */
export function encodeMultiAnswer(values: readonly string[], options: readonly string[]): string | null {
  const picked = [...new Set(values)].sort((a, b) => options.indexOf(a) - options.indexOf(b));
  return picked.length === 0 ? null : JSON.stringify(picked);
}

/** 保存した複数選択の回答(JSON の配列)を読む。読めなければ空の配列 */
export function decodeMultiAnswer(stored: string | null | undefined): string[] {
  if (!stored) return [];
  try {
    const v = JSON.parse(stored) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [stored];
  }
}

/** 回答を画面と CSV に出す文にする(複数選択は「・」でつなぐ) */
export function surveyAnswerText(kind: SurveyKind, stored: string | null | undefined): string | null {
  if (stored == null || stored === '') return null;
  if (kind !== 'multi') return stored;
  const list = decodeMultiAnswer(stored);
  return list.length ? list.join('・') : null;
}

/** 郵便番号を7桁の数字にそろえる。空なら null、形が違えば undefined。 */
export function normalizePostalCode(input: string | null | undefined): string | null | undefined {
  if (input == null) return null;
  const digits = input.normalize('NFKC').replace(/[\s〒ー−‐-]/g, '');
  if (digits === '') return null;
  return /^\d{7}$/.test(digits) ? digits : undefined;
}

/** 確かめた回答。いくつでも選ぶ質問は、保存する形(JSON の配列。encodeMultiAnswer)にしてある */
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
    const raw = given.get(q.id) ?? null;
    if (q.kind === 'multi') {
      const list = raw === null ? [] : Array.isArray(raw) ? raw.map((x) => x.trim()).filter(Boolean) : raw.trim() ? [raw.trim()] : [];
      if (list.length === 0) {
        if (enforceRequired && q.required) return { ok: false, message: `「${q.label}」を1つ以上選んでください。` };
        values.set(q.id, null);
        continue;
      }
      if (list.some((x) => !q.options.includes(x))) {
        return { ok: false, message: `「${q.label}」の選択肢が変わりました。画面を読み込み直して、選び直してください。` };
      }
      values.set(q.id, encodeMultiAnswer(list, q.options));
      continue;
    }
    if (Array.isArray(raw)) {
      return { ok: false, message: `「${q.label}」の答え方が変わりました。画面を読み込み直して、答え直してください。` };
    }
    let v = raw;
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

/** 招待を受けて参加する(POST /api/invites/:code/accept)の入力(C-12) */
export const inviteAcceptSchema = z.object({
  /** はじめての人は、利用規約とプライバシーポリシーへの同意が必要(15.2) */
  consent: z.boolean(),
  survey: surveyAnswersSchema,
});
