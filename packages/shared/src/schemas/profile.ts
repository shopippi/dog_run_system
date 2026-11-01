import { z } from 'zod';
import { surveyAnswersSchema } from './survey';

// 入力チェック(profile: 飼い主とワンちゃんの情報。担当J)

/** 管理者がおうちのアンケートの回答(おうちへの固定の質問)を変える(PATCH /admin/api/households/:id/profile) */
export const householdProfilePatchSchema = z.object({ answers: surveyAnswersSchema.min(1, { error: '変える回答がありません。答えを選んでから保存してください。' }) });
export type HouseholdProfilePatch = z.infer<typeof householdProfilePatchSchema>;
