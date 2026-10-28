import { z } from 'zod';

// 初回登録(POST /api/register)の入力。画面と API で同じ定義を使う。

export const registerSchema = z.object({
  /** 利用規約とプライバシーポリシーへの同意(C-01) */
  consent: z.literal(true, { error: '利用規約とプライバシーポリシーへの同意が必要です。チェックを入れてください。' }),
});
export type RegisterInput = z.infer<typeof registerSchema>;
