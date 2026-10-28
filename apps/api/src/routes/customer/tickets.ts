import { ticketExchangeSchema, type TicketHistoryResponse, type TicketUseDetail } from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { loadSettings } from '../../lib/settings';
import { parseJson } from '../../lib/validate';
import { requireMember } from '../../services/members';
import { exchangeTicket, ticketHistory, ticketUseDetail, useTicket } from '../../services/tickets';

// C-06 無料券の交換と使用(8章)。お客さん向け(LINE の IDトークンで認証)
export const ticketRoutes = new Hono<AppEnv>();

// 無料券の記録(交換と使用)。来場履歴(L-08)に出す
ticketRoutes.get('/tickets/history', async (c) => {
  const member = await requireMember(c.env.DB, c.get('lineUser').userId);
  const body: TicketHistoryResponse = { events: await ticketHistory(c.env.DB, member.householdId) };
  return c.json(body);
});

// 無料券と交換する。ポイントが無料券1枚分以上あるときだけ
ticketRoutes.post('/tickets/exchange', async (c) => {
  const db = c.env.DB;
  const member = await requireMember(db, c.get('lineUser').userId);
  const input = await parseJson(c, ticketExchangeSchema);
  const body = await exchangeTicket(db, {
    householdId: member.householdId,
    memberId: member.memberId,
    opId: input.opId,
    settings: await loadSettings(db),
    now: c.get('now'),
  });
  return c.json(body, 201);
});

// 無料券を使う。受付で画面を見せながら押してもらう。応答は「使用しました」の画面の内容(サーバーの時刻つき)
ticketRoutes.post('/tickets/:id/use', async (c) => {
  const db = c.env.DB;
  const member = await requireMember(db, c.get('lineUser').userId);
  const now = c.get('now');
  const used = await useTicket(db, {
    householdId: member.householdId,
    ticketId: Number(c.req.param('id')),
    actor: { type: 'member', id: member.memberId },
    now,
  });
  const body: TicketUseDetail = await ticketUseDetail(db, member, used.ticketId, now);
  return c.json(body);
});

// 「無料券を使用しました」の画面の内容。自分のおうちの使用済みの券だけ
ticketRoutes.get('/tickets/:id', async (c) => {
  const db = c.env.DB;
  const member = await requireMember(db, c.get('lineUser').userId);
  const body: TicketUseDetail = await ticketUseDetail(db, member, Number(c.req.param('id')), c.get('now'));
  return c.json(body);
});
