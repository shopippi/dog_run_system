import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { requireRole } from '../../lib/staff-auth';
import { registerAuditDetail } from '../../services/audit-view';
import { markTicketUsed, undoTicketExchange, undoTicketUse } from '../../services/tickets';
import { registerUndo } from '../../services/undo';

// 無料券の使用(管理画面)。お客さんがスマホを持っていないときなどに、おうちの詳細(M-06)から使用済みにする(8章)
export const adminTicketRoutes = new Hono<AppEnv>();

// 無料券を使用済みにする。受付スタッフと管理者(製作者は見るだけ)。操作ログから元に戻せる
adminTicketRoutes.post('/households/:id/tickets/:tid/use', requireRole('staff', 'admin'), async (c) => {
  const db = c.env.DB;
  const householdId = Number(c.req.param('id'));
  const h = Number.isInteger(householdId)
    ? await db.prepare('SELECT status FROM households WHERE id = ?').bind(householdId).first<{ status: string }>()
    : null;
  if (!h) throw errors.notFound('おうちが見つかりませんでした。おうちを探す画面から、もう一度探してください。');
  if (h.status !== 'active') {
    throw errors.conflict('household_inactive', 'このおうちは統合済みか退会済みです。統合先のおうちを開いて操作してください。');
  }
  const body = await markTicketUsed(db, {
    householdId,
    ticketId: Number(c.req.param('tid')),
    staffId: c.get('staff').id,
    now: c.get('now'),
  });
  return c.json(body);
});

const md = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${m}月${d}日 ${iso.slice(11, 16)}`;
};
registerAuditDetail('ticket.exchange', (_b, a) => (a?.points ? `${a.points}ポイントを無料券1枚と交換` : null));
registerAuditDetail('ticket.use', (_b, a) => (a?.usedAt ? `${md(a.usedAt)}に無料券を1枚使用` : null));
registerAuditDetail('ticket.mark_used', (_b, a) => (a?.usedAt ? `無料券1枚を使用済みにした(${md(a.usedAt)})` : null));

// 操作ログから元に戻す(A-15)。使用は未使用に戻し、交換は券を取り消してポイントを戻す
registerUndo('ticket.use', undoTicketUse);
registerUndo('ticket.mark_used', undoTicketUse);
registerUndo('ticket.exchange', undoTicketExchange);
