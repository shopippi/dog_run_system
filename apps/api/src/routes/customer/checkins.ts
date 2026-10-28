import { addVisitDogsSchema, checkinSchema, toJstDate, type CheckinStatus } from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { loadSettings } from '../../lib/settings';
import { parseJson } from '../../lib/validate';
import { addDogsToVisit, recordCheckin, requireActiveDogs, todayVisit } from '../../services/checkins';
import { listHouseholdDogs } from '../../services/dogs';
import { requireMember } from '../../services/members';
import { pointBalance, unusedTicketCount } from '../../services/points';
import { MEDIA_BASE } from './media';

export const checkinRoutes = new Hono<AppEnv>();

// チェックイン画面の表示内容(C-04)。今日すでにおうちの誰かがチェックインしていれば、その来場を返す(5.5)
checkinRoutes.get('/checkins/today', async (c) => {
  const member = await requireMember(c.env.DB, c.get('lineUser').userId);
  const now = c.get('now');
  const body: CheckinStatus = {
    today: toJstDate(now),
    visit: await todayVisit(c.env.DB, member.householdId, member.memberId, now),
    dogs: await listHouseholdDogs(c.env.DB, member.householdId, MEDIA_BASE),
    balance: await pointBalance(c.env.DB, member.householdId),
    unusedTickets: await unusedTicketCount(c.env.DB, member.householdId, now),
  };
  return c.json(body);
});

// チェックイン(C-04)。受付QRの合言葉・犬・無料券を使うかを受け取る
checkinRoutes.post('/checkins', async (c) => {
  const member = await requireMember(c.env.DB, c.get('lineUser').userId);
  const input = await parseJson(c, checkinSchema);
  const settings = await loadSettings(c.env.DB);
  if (input.passphrase !== settings.checkin_passphrase) {
    throw errors.badRequest(
      '受付のQRコードを確認できませんでした。受付にあるQRコードを、LINEのカメラでもう一度読み取ってください。',
    );
  }
  const dogIds = await requireActiveDogs(c.env.DB, member.householdId, input.dogIds);
  const now = c.get('now');
  const result = await recordCheckin(c.env.DB, {
    householdId: member.householdId,
    memberId: member.memberId,
    staffId: null,
    method: 'self',
    dogIds,
    useTicket: input.useTicket,
    visitDate: toJstDate(now),
    now,
    settings,
  });
  return c.json(result, 201);
});

// 同じ日に家族が来たとき、一緒に来た犬を追加する(C-04、5.5)
checkinRoutes.post('/checkins/:id/dogs', async (c) => {
  const member = await requireMember(c.env.DB, c.get('lineUser').userId);
  const visitId = Number(c.req.param('id'));
  const { dogIds } = await parseJson(c, addVisitDogsSchema);
  const now = c.get('now');
  const visit = await c.env.DB.prepare(
    'SELECT id, household_id, visit_date, cancelled_at FROM visits WHERE id = ?',
  )
    .bind(Number.isInteger(visitId) ? visitId : 0)
    .first<{ id: number; household_id: number; visit_date: string; cancelled_at: string | null }>();
  if (!visit || visit.household_id !== member.householdId) {
    throw errors.notFound('今日のチェックインが見つかりませんでした。画面を読み込み直してください。');
  }
  if (visit.cancelled_at || visit.visit_date !== toJstDate(now)) {
    throw errors.conflict('not_today', 'このチェックインには、もうワンちゃんを追加できません。受付にお知らせください。');
  }
  const ids = await requireActiveDogs(c.env.DB, member.householdId, dogIds);
  await addDogsToVisit(c.env.DB, visit.id, visit.visit_date, ids, member.memberId, now);
  return c.json({ visit: await todayVisit(c.env.DB, member.householdId, member.memberId, now) });
});
