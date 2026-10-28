import { z } from 'zod';

// 入力チェック(households: おうちの詳細と記録、操作ログ)

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: '日付を選び直してください。' });

/** 操作ログの絞り込み(A-15)。空の値は「絞り込まない」 */
export const auditQuerySchema = z.object({
  from: ymd.optional(),
  to: ymd.optional(),
  action: z.string().max(60).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

/** 操作ログの1ページの行数 */
export const AUDIT_PAGE_SIZE = 50;
