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

/** 会員以外のお客さんの頭数の記録(S-05) */
export const walkinSchema = z.object({
  dogCount: z
    .number({ error: '頭数を入れてください。' })
    .int({ error: '頭数は数字で入れてください。' })
    .min(1, { error: '頭数は1頭以上で入れてください。' })
    .max(30, { error: '一度に記録できるのは30頭までです。' }),
});

/** 代理チェックイン(S-04)。日付を指定して後から入力することもできる */
export const proxyCheckinSchema = z.object({
  householdId: z.number().int().positive(),
  dogIds: z.array(z.number().int().positive()).min(1, { error: '来たワンちゃんを1頭以上選んでください。' }).max(30),
  /** 来場日(日本時間)。省略すると今日 */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: '日付を選び直してください。' })
    .optional(),
});

/** 後から入力できるのは、何日前までか */
export const PROXY_MAX_DAYS_BACK = 90;
