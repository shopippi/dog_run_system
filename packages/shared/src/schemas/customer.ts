import { z } from 'zod';
import { MIGRATION_SOURCES } from '../constants';
import { surveyAnswersSchema } from './survey';

// 入力チェック(customer)。お客さん向けの残りの機能(C-07・C-09・C-10・C-13)

// ---------------------------------------------------------------
// C-10 旧カードの引き継ぎ申請
// ---------------------------------------------------------------

/** 旧カードの写真。スマホの中で長い辺 1200px まで縮小した JPEG(文字が読めるよう、犬の写真より大きめ) */
export const MIGRATION_PHOTO_MAX_EDGE = 1200;
export const MIGRATION_PHOTO_MAX_BYTES = 1_000_000;
/** 申告できるポイント数の上限(旧カードは10ポイントで1周するが、ためていた分も書けるよう2桁まで) */
export const MIGRATION_POINTS_MAX = 99;
export const MIGRATION_NOTE_MAX = 200;

export const migrationRequestSchema = z.object({
  source: z.enum(MIGRATION_SOURCES, { error: '引き継ぐカード(LINEのショップカード・紙のスタンプカード)を選んでください。' }),
  claimedPoints: z
    .number({ error: `ポイント数は0から${MIGRATION_POINTS_MAX}までの数字で入力してください(分からなければ空欄)。` })
    .int({ error: `ポイント数は0から${MIGRATION_POINTS_MAX}までの数字で入力してください(分からなければ空欄)。` })
    .min(0, { error: `ポイント数は0から${MIGRATION_POINTS_MAX}までの数字で入力してください(分からなければ空欄)。` })
    .max(MIGRATION_POINTS_MAX, {
      error: `ポイント数は0から${MIGRATION_POINTS_MAX}までの数字で入力してください(分からなければ空欄)。`,
    })
    .nullable(),
  note: z
    .string()
    .trim()
    .max(MIGRATION_NOTE_MAX, { error: `メモは${MIGRATION_NOTE_MAX}文字までで入力してください。` })
    .nullable(),
});
export type MigrationRequestInput = z.infer<typeof migrationRequestSchema>;

/**
 * 画面の入力(文字)を申請の形にする。ポイント数は全角の数字も受け付け、空なら null。
 * 数字として読めないときは NaN にして、入力チェックで日本語のメッセージを出す。
 */
export function migrationFormToInput(fields: {
  source: string | null | undefined;
  claimedPoints: string | null | undefined;
  note: string | null | undefined;
}): unknown {
  const raw = (fields.claimedPoints ?? '').normalize('NFKC').trim();
  const note = (fields.note ?? '').trim();
  return {
    source: fields.source || undefined,
    claimedPoints: raw === '' ? null : /^\d+$/.test(raw) ? Number(raw) : Number.NaN,
    note: note === '' ? null : note,
  };
}

// ---------------------------------------------------------------
// C-09 プロフィール
// ---------------------------------------------------------------

/** PATCH /api/me/profile。送った質問の回答だけを変える(null は「答えない」) */
export const profilePatchSchema = z.object({ answers: surveyAnswersSchema });
