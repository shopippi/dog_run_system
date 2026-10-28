import {
  PROXY_MAX_DAYS_BACK,
  addDays,
  cancelCheckinSchema,
  proxyCheckinSchema,
  toJstDate,
  toJstIso,
  walkinSchema,
  type ProxyStatus,
} from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { loadSettings } from '../../lib/settings';
import { requireRole } from '../../lib/staff-auth';
import { parseJson } from '../../lib/validate';
import { auditStatement } from '../../services/audit';
import { cancelCheckin, findVisitOn, recordCheckin, requireActiveDogs } from '../../services/checkins';
import { unusedTicketCount } from '../../services/points';

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

/** 代理チェックインの日付を確かめる。未来の日と、PROXY_MAX_DAYS_BACK 日より前は受け付けない */
function proxyDate(input: string | undefined, now: Date): string {
  const today = toJstDate(now);
  const date = input ?? today;
  if (date > today) throw errors.badRequest('先の日付には入力できません。今日か、それより前の日を選んでください。');
  if (date < addDays(today, -PROXY_MAX_DAYS_BACK)) {
    throw errors.badRequest(`入力できるのは${PROXY_MAX_DAYS_BACK}日前までです。それより前の分は、ポイントの手動登録で調整してください。`);
  }
  return date;
}

async function requireActiveHousehold(db: D1Database, householdId: number) {
  const h = await db.prepare('SELECT status FROM households WHERE id = ?').bind(householdId).first<{ status: string }>();
  if (!h) throw errors.notFound('おうちが見つかりませんでした。もう一度探してください。');
  if (h.status !== 'active') {
    throw errors.conflict('household_inactive', 'このおうちは統合済みか退会済みです。統合先のおうちを探して、チェックインしてください。');
  }
}

// 代理チェックインの前に、その日のチェックインと使える無料券を確かめる(S-04)
adminCheckinRoutes.get('/checkins/proxy/status', requireRole('staff', 'admin'), async (c) => {
  const householdId = Number(c.req.query('householdId')) || 0;
  const now = c.get('now');
  const date = proxyDate(c.req.query('date') || undefined, now);
  await requireActiveHousehold(c.env.DB, householdId);
  const visit = await findVisitOn(c.env.DB, householdId, date);
  const body: ProxyStatus = {
    date,
    unusedTickets: await unusedTicketCount(c.env.DB, householdId, now),
    visitId: visit?.id ?? null,
  };
  return c.json(body);
});

// 代理チェックイン(S-04)。スマホを持っていないお客さんを、受付が代わりにチェックインする。
// 障害のときに紙に書いた分を、日付を指定して後から入力することもできる(15.2)
adminCheckinRoutes.post('/checkins/proxy', requireRole('staff', 'admin'), async (c) => {
  const input = await parseJson(c, proxyCheckinSchema);
  const db = c.env.DB;
  const now = c.get('now');
  const staff = c.get('staff');
  const date = proxyDate(input.date, now);
  await requireActiveHousehold(db, input.householdId);
  const dogIds = await requireActiveDogs(db, input.householdId, input.dogIds);
  const visitIdSql = {
    sql: 'SELECT id FROM visits WHERE household_id = ? AND visit_date = ? AND cancelled_at IS NULL',
    args: [input.householdId, date],
  };
  const result = await recordCheckin(db, {
    householdId: input.householdId,
    memberId: null,
    staffId: staff.id,
    method: 'proxy',
    dogIds,
    useTicket: input.useTicket,
    visitDate: date,
    now,
    settings: await loadSettings(db),
    extra: [
      auditStatement(db, {
        staffId: staff.id,
        action: 'visit.proxy',
        targetType: 'visit',
        targetId: visitIdSql,
        after: { householdId: input.householdId, date, dogIds, useTicket: input.useTicket },
        now,
      }),
    ],
  });
  return c.json(result, 201);
});
