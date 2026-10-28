import { z } from 'zod';

// 入力チェック(tickets)。無料券の交換(C-06)

/**
 * 無料券と交換する(POST /api/tickets/exchange)。
 * opId は画面が確認のたびに作る印。二重に送られても、同じ印の交換は1回だけにする
 */
export const ticketExchangeSchema = z.object({
  opId: z
    .string()
    .regex(/^[A-Za-z0-9-]{8,64}$/, { error: '画面を読み込み直して、もう一度お試しください。' })
    .optional(),
});
export type TicketExchangeInput = z.infer<typeof ticketExchangeSchema>;
