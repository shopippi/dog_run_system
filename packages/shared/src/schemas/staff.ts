import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email({ error: 'メールアドレスの形を確かめてください。' }),
  password: z.string().min(1, { error: 'パスワードを入力してください。' }).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MINUTES = 15;
export const SESSION_DAYS = 30;
