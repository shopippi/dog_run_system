import { z } from 'zod';

// 入力チェック(merge)。おうちの統合(A-07)・確認待ち(A-08)・旧カードの移行(A-05)

const idSchema = z.number().int().positive();

/** 同じ犬の組み合わせ。take は写真・名前・犬種をどちらから残すか */
export const mergeDogPairSchema = z.object({
  keep: idSchema,
  absorb: idSchema,
  take: z.enum(['keep', 'absorb']),
});

/** 統合の確認(POST /admin/api/merges/preview)と実行(POST /admin/api/merges)の入力 */
export const mergeInputSchema = z
  .object({
    /** 残すおうち */
    keepHouseholdId: idSchema,
    /** まとめるおうち(統合後は「統合済み」になる) */
    absorbHouseholdId: idSchema,
    dogPairs: z.array(mergeDogPairSchema).max(30).default([]),
    /** まとめる申請から進んだときの申請(統合したら承認にする) */
    requestId: idSchema.optional(),
  })
  .refine((v) => v.keepHouseholdId !== v.absorbHouseholdId, {
    error: '同じおうちどうしはまとめられません。まとめる相手のおうちを選び直してください。',
  });
export type MergeInput = z.infer<typeof mergeInputSchema>;

/** 却下の理由(確認待ち、A-05・A-08)。選択式 */
export const REJECT_REASONS = {
  merge: ['同じ家族ではない', 'すでにまとめてある', 'お客さんから取り消しの連絡', 'その他'],
  migration: ['写真でポイントが確認できない', 'すでに引き継ぎ済み', 'お客さんから取り消しの連絡', 'その他'],
} as const;

/** 申請の却下(POST /admin/api/requests/:id/reject) */
export const rejectRequestSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, { error: '却下する理由を選んでください。' })
    .max(200, { error: '理由は200文字までで入力してください。' }),
});
