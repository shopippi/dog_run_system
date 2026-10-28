import { z } from 'zod';
import { surveyAnswersSchema } from './survey';

// 入力チェック(customer)。お客さん向けの残りの機能(C-07・C-09・C-13)。C-10 旧カードの引き継ぎ申請はやめた(16.1。受付で直接入力だけ)

// ---------------------------------------------------------------
// C-09 プロフィール
// ---------------------------------------------------------------

/** PATCH /api/me/profile。送った質問の回答だけを変える(null は「答えない」) */
export const profilePatchSchema = z.object({ answers: surveyAnswersSchema });
