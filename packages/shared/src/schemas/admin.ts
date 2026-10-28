import { z } from 'zod';

export const CANCEL_REASONS = ['入力ミス', '二重のチェックイン', 'お客さんの勘違い', 'その他'] as const;

/** チェックインの取り消し(S-03) */
export const cancelCheckinSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, { error: '取り消す理由を選んでください。' })
    .max(100, { error: '理由は100文字までで入力してください。' }),
});
