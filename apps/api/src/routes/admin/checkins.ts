import { cancelCheckinSchema, toJstDate, toJstIso, walkinSchema } from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { requireRole } from '../../lib/staff-auth';
import { parseJson } from '../../lib/validate';
import { auditStatement } from '../../services/audit';
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

// 会員以外のお客さんの頭数を記録する(S-05)。来場者数の集計に含める
adminCheckinRoutes.post('/walkins', requireRole('staff', 'admin'), async (c) => {
  const { dogCount } = await parseJson(c, walkinSchema);
  const db = c.env.DB;
  const now = c.get('now');
  const staff = c.get('staff');
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO visits (household_id, visit_date, checked_in_at, dog_count, method, created_by_staff_id)
         VALUES (NULL, ?, ?, ?, 'walkin', ?)`,
      )
      .bind(toJstDate(now), toJstIso(now), dogCount, staff.id),
    auditStatement(db, {
      staffId: staff.id,
      action: 'visit.walkin',
      targetType: 'visit',
      targetId: { sql: 'last_insert_rowid()' },
      after: { dogCount },
      now,
    }),
  ]);
  return c.json({ id: results[0]!.meta.last_row_id }, 201);
});
