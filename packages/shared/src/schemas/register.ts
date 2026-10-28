import { z } from 'zod';
import { MAX_DOGS_AT_REGISTER, dogInputSchema } from './dog';
import { surveyAnswersSchema } from './survey';

// 初回登録(POST /api/register)の入力。画面と API で同じ定義を使う。

export const registerSchema = z.object({
  /** 利用規約とプライバシーポリシーへの同意(C-01) */
  consent: z.literal(true, { error: '利用規約とプライバシーポリシーへの同意が必要です。チェックを入れてください。' }),
  /** ワンちゃん。初回は1頭以上(C-02) */
  dogs: z
    .array(dogInputSchema)
    .min(1, { error: 'ワンちゃんを1頭以上登録してください。' })
    .max(MAX_DOGS_AT_REGISTER, { error: `一度に登録できるのは${MAX_DOGS_AT_REGISTER}頭までです。残りは登録のあとに追加してください。` }),
  /** アンケートの回答。固定の質問と、管理者が追加した質問(C-03) */
  survey: surveyAnswersSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;
