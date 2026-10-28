import { cancelCheckinSchema } from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { requireRole } from '../../lib/staff-auth';
import { parseJson } from '../../lib/validate';
import { cancelCheckin } from '../../services/checkins';

export const adminCheckinRoutes = new Hono<AppEnv>();

// チェックインの取り消し(S-03)。受付スタッフと管理者
adminCheckinRoutes.post('/checkins/:id/cancel', requireRole('staff', 'admin'), async (c) => {
  const { reason } = await parseJson(c, cancelCheckinSchema);
  await cancelCheckin(c.env.DB, {
    visitId: Number(c.req.param('id')) || 0,
    staffId: c.get('staff').id,
    reason,
    now: c.get('now'),
  });
  return c.json({ ok: true });
});
