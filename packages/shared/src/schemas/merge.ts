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
