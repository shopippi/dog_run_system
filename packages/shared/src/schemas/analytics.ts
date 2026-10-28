import { z } from 'zod';

// 入力チェック(analytics)

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: '日付の形が正しくありません。期間を選び直してください。' });

/** ダッシュボードの期間(A-01)。from・to とも日本時間の日付。省略すると今月 */
export const dashboardQuerySchema = z
  .object({ from: ymd.optional(), to: ymd.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { error: '期間の始まりが終わりより後になっています。期間を選び直してください。' });

/** ダッシュボードで一度に見られる長さ(日) */
export const DASHBOARD_MAX_DAYS = 1100;
