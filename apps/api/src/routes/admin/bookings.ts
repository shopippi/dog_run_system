import {
  BOOKING_SERVICE_LABELS,
  BOOKING_STATUS_LABELS,
  bookingCalendarQuerySchema,
  bookingCancelSchema,
  bookingDecisionSchema,
  bookingManualSchema,
  capacityOverrideSchema,
  formatBookingDate,
  stayExperienceSchema,
  toJstDate,
  toJstIso,
  type AdminBookingListResponse,
  type AdminBookingSaved,
  type BookingCalendarResponse,
  type BookingDayResponse,
  type BookingService,
  type BookingStatus,
} from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { loadSettings } from '../../lib/settings';
import { requireRole } from '../../lib/staff-auth';
import { parseInput, parseJson } from '../../lib/validate';
import { ADMIN_MEDIA_BASE } from '../../services/admin-visits';
import { auditStatement, latestAuditId } from '../../services/audit';
import { registerAuditDetail } from '../../services/audit-view';
import {
  activeOverride,
  adminDetail,
  adminList,
  createBooking,
  dayCounts,
  experiencedDogIds,
  findBooking,
  householdActiveDogs,
  pendingCount,
  revertBookingStatus,
  transitionBooking,
  type Transition,
} from '../../services/bookings';
import { notifyBooking } from '../../services/line-push';
import { registerUndo } from '../../services/undo';
import { bookingRules } from '../customer/bookings';

// A-18 予約カレンダー・A-19 確認待ちの予約・A-20 予約の手入力・A-21 予約の状態の変更・A-22 予約の設定(受け入れ数の上書き)
// 権限(要件定義書 21.7):
// - 見る: 全員(製作者は見るだけ。変更系は requireStaff が 403 にする)
// - 状態の変更・承認とお断り・手入力: 受付スタッフと管理者
// - いっぱいの日に入れる(理由つき)・その日の受け入れ数を変える・預かり経験ありの印: 管理者だけ
// 注意: このファイルのルートは管理画面の API 全体に足されるので、use('*') で権限を付けない。ルートごとに付ける。
export const adminBookingRoutes = new Hono<AppEnv>();

const ymd = /^\d{4}-\d{2}-\d{2}$/;

// 予約の画面に要る設定(料金・時間など。受付スタッフも見られる。ルールの設定の画面は管理者だけ)
adminBookingRoutes.get('/bookings/options', async (c) => {
  const settings = await loadSettings(c.env.DB);
  return c.json({ today: toJstDate(c.get('now')), rules: bookingRules(settings) });
});

// 予約カレンダー(A-18)。1日ずつ、受け入れ数・使っている数(サイズごと)・予約の数・確認待ちの数
adminBookingRoutes.get('/bookings/calendar', async (c) => {
  const q = parseInput(bookingCalendarQuerySchema, c.req.query());
  const db = c.env.DB;
  const settings = await loadSettings(db);
  const body: BookingCalendarResponse = {
    service: q.service,
    days: await dayCounts(db, settings, q.service, q.from, q.to),
    pendingTotal: await pendingCount(db),
  };
  return c.json(body);
});

// その日の予約(A-18 の日のパネル)。お泊まりは、泊まっている子とチェックアウトの子
adminBookingRoutes.get('/bookings/day', async (c) => {
  const date = c.req.query('date') ?? '';
  const service = c.req.query('service') as BookingService;
  if (!ymd.test(date) || (service !== 'daycare' && service !== 'boarding')) {
    throw errors.badRequest('日にちを選び直してください。');
  }
  const db = c.env.DB;
  const settings = await loadSettings(db);
  const [counts] = await dayCounts(db, settings, service, date, date);
  const ov = await activeOverride(db, service, date);
  const body: BookingDayResponse = {
    date,
    service,
    counts: counts!,
    override: ov ? { closed: ov.closed === 1, caps: { small: ov.cap_small, medium: ov.cap_medium, large: ov.cap_large }, note: ov.note } : null,
    bookings: await adminList(
      db,
      "b.service = ? AND b.start_date <= ? AND b.end_date >= ? AND b.status NOT IN ('declined', 'cancelled')",
      [service, date, date],
      ADMIN_MEDIA_BASE,
    ),
  };
  return c.json(body);
});

// 確認待ちの数(サイドバーの印)
adminBookingRoutes.get('/bookings/pending-count', async (c) => c.json({ count: await pendingCount(c.env.DB) }));

// 予約の一覧(?status=pending で確認待ち。?householdId= でおうちごと)
adminBookingRoutes.get('/bookings', async (c) => {
  const status = c.req.query('status') as BookingStatus | undefined;
  const householdId = Number(c.req.query('householdId') ?? 0);
  const where: string[] = ['1 = 1'];
  const args: unknown[] = [];
  if (status) {
    if (!(status in BOOKING_STATUS_LABELS)) throw errors.badRequest('状態を選び直してください。');
    where.push('b.status = ?');
    args.push(status);
  }
  if (householdId > 0) {
    where.push('b.household_id = ?');
    args.push(householdId);
  }
  // 期間(週の表示): その期間にかかる予約。お断り・キャンセルは除く
  const from = c.req.query('from');
  const to = c.req.query('to');
  const service = c.req.query('service');
  if (from || to) {
    if (!from || !to || !ymd.test(from) || !ymd.test(to)) throw errors.badRequest('期間を選び直してください。');
    where.push("b.start_date <= ? AND b.end_date >= ? AND b.status NOT IN ('declined', 'cancelled')");
    args.push(to, from);
  }
  if (service === 'daycare' || service === 'boarding') {
    where.push('b.service = ?');
    args.push(service);
  }
  const body: AdminBookingListResponse = {
    bookings: await adminList(c.env.DB, where.join(' AND '), args, ADMIN_MEDIA_BASE, status === 'pending' ? 'b.created_at, b.id' : from ? 'b.start_date, b.start_time, b.id' : 'b.start_date DESC, b.id DESC'),
  };
  return c.json(body);
});

// 手入力のときに選べるワンちゃん(預かりの経験つき)
adminBookingRoutes.get('/bookings/household-dogs/:householdId', async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('householdId'));
  const dogs = await householdActiveDogs(db, Number.isInteger(id) ? id : 0);
  const exp = await experiencedDogIds(db, dogs.map((d) => d.id));
  return c.json({
    dogs: dogs.map((d) => ({
      id: d.id,
      name: d.name,
      breedName: d.breed_name,
      size: d.size,
      thumbUrl: d.thumb_key ? `${ADMIN_MEDIA_BASE}/${d.thumb_key}` : null,
      experienced: exp.has(d.id),
      vaccineNotice: null,
    })),
  });
});

// その日の受け入れ数の上書きの一覧
adminBookingRoutes.get('/bookings/overrides', async (c) => {
  const from = c.req.query('from') ?? '';
  const to = c.req.query('to') ?? '';
  if (!ymd.test(from) || !ymd.test(to)) throw errors.badRequest('期間を選び直してください。');
  const { results } = await c.env.DB.prepare(
    'SELECT date, service, closed, cap_small, cap_medium, cap_large, note FROM booking_capacity_overrides WHERE date BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY date, service',
  )
    .bind(from, to)
    .all();
  return c.json({ overrides: results });
});

// その日の受け入れ数を変える・休みにする・いつもの数に戻す(管理者)。前の行は消さずに deleted_at を入れる
adminBookingRoutes.put('/bookings/overrides', requireRole('admin'), async (c) => {
  const input = await parseJson(c, capacityOverrideSchema);
  const db = c.env.DB;
  const staff = c.get('staff');
  const now = c.get('now');
  const nowIso = toJstIso(now);
  const prev = await activeOverride(db, input.service, input.date);
  if (input.reset && !prev) return c.json({ ok: true, auditId: null });
  const statements: D1PreparedStatement[] = [];
  if (prev) {
    statements.push(
      db.prepare('UPDATE booking_capacity_overrides SET deleted_at = ?, deleted_by_staff_id = ? WHERE id = ? AND deleted_at IS NULL').bind(nowIso, staff.id, prev.id),
    );
  }
  if (!input.reset) {
    statements.push(
      db
        .prepare(
          `INSERT INTO booking_capacity_overrides (date, service, closed, cap_small, cap_medium, cap_large, note, created_by_staff_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(input.date, input.service, input.closed ? 1 : 0, input.caps.small, input.caps.medium, input.caps.large, input.note, staff.id, nowIso),
    );
  }
  statements.push(
    auditStatement(db, {
      staffId: staff.id,
      action: 'booking.override',
      targetType: 'booking_override',
      targetId: `${input.service}:${input.date}`,
      before: prev ? { id: prev.id, closed: prev.closed === 1, caps: { small: prev.cap_small, medium: prev.cap_medium, large: prev.cap_large }, note: prev.note } : null,
      after: input.reset ? null : { closed: input.closed, caps: input.caps, note: input.note },
      undo: { prevId: prev?.id ?? null },
      now,
    }),
  );
  await db.batch(statements);
  return c.json({
    ok: true,
    auditId: await latestAuditId(db, { action: 'booking.override', targetType: 'booking_override', targetId: `${input.service}:${input.date}`, staffId: staff.id }),
  });
});

// 予約の内容
adminBookingRoutes.get('/bookings/:id{[0-9]+}', async (c) => c.json(await adminDetail(c.env.DB, Number(c.req.param('id')), ADMIN_MEDIA_BASE)));

// 受付で予約を入れる(A-20)。電話・DM で受けた予約。いっぱいなら 409、管理者は理由を書けば入れられる
adminBookingRoutes.post('/bookings', requireRole('staff', 'admin'), async (c) => {
  const input = await parseJson(c, bookingManualSchema);
  const staff = c.get('staff');
  if (input.overrideReason && staff.role !== 'admin') {
    throw errors.forbidden('いっぱいの日に入れられるのは管理者だけです。管理者に依頼してください。');
  }
  const db = c.env.DB;
  const hh = await db.prepare("SELECT id FROM households WHERE id = ? AND status = 'active'").bind(input.householdId).first();
  if (!hh) throw errors.notFound('おうちが見つかりませんでした。おうちを選び直してください。');
  const settings = await loadSettings(db);
  const now = c.get('now');
  const id = await createBooking(db, settings, {
    ...input,
    checklist: [],
    source: 'staff',
    memberId: null,
    staffId: staff.id,
    now,
  });
  const body: AdminBookingSaved = {
    booking: await adminDetail(db, id, ADMIN_MEDIA_BASE),
    auditId: await latestAuditId(db, { action: 'booking.create', targetType: 'booking', targetId: id, staffId: staff.id }),
  };
  return c.json(body, 201);
});

/** 状態を変える操作(A-19・A-21)。受付スタッフと管理者 */
function transitionRoute(path: string, t: Transition) {
  adminBookingRoutes.post(`/bookings/:id{[0-9]+}/${path}`, requireRole('staff', 'admin'), async (c) => {
    const db = c.env.DB;
    const staff = c.get('staff');
    const now = c.get('now');
    const row = await findBooking(db, Number(c.req.param('id')));
    let message: string | null = null;
    let reason: string | null = null;
    if (t === 'approve' || t === 'decline') message = (await parseJson(c, bookingDecisionSchema)).message;
    if (t === 'cancel') reason = (await parseJson(c, bookingCancelSchema)).reason;
    await transitionBooking(db, row, t, { type: 'staff', id: staff.id }, now, { message, reason });
    if (t === 'approve') await notifyBooking(c.env, row.id, 'confirmed', now);
    if (t === 'decline') await notifyBooking(c.env, row.id, 'declined', now);
    const body: AdminBookingSaved = {
      booking: await adminDetail(db, row.id, ADMIN_MEDIA_BASE),
      auditId: await latestAuditId(db, { action: `booking.${t}`, targetType: 'booking', targetId: row.id, staffId: staff.id }),
    };
    return c.json(body);
  });
}
transitionRoute('approve', 'approve');
transitionRoute('decline', 'decline');
transitionRoute('check-in', 'check_in');
transitionRoute('complete', 'complete');
transitionRoute('no-show', 'no_show');
transitionRoute('cancel', 'cancel');

// 預かり経験ありの印(紙の台帳のころに預かった子)。管理者
adminBookingRoutes.post('/dogs/:id{[0-9]+}/stay-experience', requireRole('admin'), async (c) => {
  const { experienced } = await parseJson(c, stayExperienceSchema);
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const dog = await db.prepare('SELECT id, name, stay_experience_at FROM dogs WHERE id = ?').bind(id).first<{ id: number; name: string; stay_experience_at: string | null }>();
  if (!dog) throw errors.notFound('ワンちゃんが見つかりませんでした。画面を読み込み直してください。');
  const staff = c.get('staff');
  const now = c.get('now');
  if ((dog.stay_experience_at !== null) === experienced) return c.json({ ok: true, auditId: null });
  await db.batch([
    db
      .prepare('UPDATE dogs SET stay_experience_at = ?, stay_experience_by_staff_id = ? WHERE id = ?')
      .bind(experienced ? toJstIso(now) : null, experienced ? staff.id : null, dog.id),
    auditStatement(db, {
      staffId: staff.id,
      action: 'dog.stay_experience',
      targetType: 'dog',
      targetId: dog.id,
      before: { experienced: !experienced, at: dog.stay_experience_at, name: dog.name },
      after: { experienced, name: dog.name },
      now,
    }),
  ]);
  return c.json({ ok: true, auditId: await latestAuditId(db, { action: 'dog.stay_experience', targetType: 'dog', targetId: dog.id, staffId: staff.id }) });
});

// ---- 操作ログから元に戻す(A-15) ----

for (const action of ['booking.approve', 'booking.decline', 'booking.check_in', 'booking.complete', 'booking.no_show', 'booking.cancel']) {
  registerUndo(action, async (db, log, ctx) => {
    const before = JSON.parse(log.before_value ?? '{}') as { status: BookingStatus };
    const after = JSON.parse(log.after_value ?? '{}') as { status: BookingStatus };
    await revertBookingStatus(db, await loadSettings(db), Number(log.target_id), after.status, before.status, ctx.now);
  });
}

// 手入力の予約を元に戻す: キャンセルにする(行は消さない)
registerUndo('booking.create', async (db, log, ctx) => {
  const row = await findBooking(db, Number(log.target_id));
  if (row.status !== 'confirmed' && row.status !== 'pending') {
    throw errors.conflict('booking_changed', 'この予約は、もう利用開始やキャンセルになっています。予約の画面で直してください。');
  }
  await transitionBooking(db, row, 'cancel', { type: 'staff', id: ctx.staffId }, ctx.now, { reason: '手入力を元に戻した' });
});

// その日の受け入れ数を元に戻す: いまの上書きに deleted_at を入れ、前の上書きを戻す
registerUndo('booking.override', async (db, log, ctx) => {
  const [service, date] = String(log.target_id).split(':') as [BookingService, string];
  const undo = JSON.parse(log.undo_info ?? '{}') as { prevId: number | null };
  const after = log.after_value ? (JSON.parse(log.after_value) as unknown) : null;
  const current = await activeOverride(db, service, date);
  // そのあとにまた変えていたら戻さない
  if ((after === null && current) || (after !== null && (!current || current.created_at !== log.created_at))) {
    throw errors.conflict('override_changed', 'この日の受け入れ数は、そのあとにまた変えられています。予約カレンダーで直してください。');
  }
  const nowIso = toJstIso(ctx.now);
  const statements: D1PreparedStatement[] = [];
  if (current) {
    statements.push(db.prepare('UPDATE booking_capacity_overrides SET deleted_at = ?, deleted_by_staff_id = ? WHERE id = ?').bind(nowIso, ctx.staffId, current.id));
  }
  if (undo.prevId) {
    statements.push(db.prepare('UPDATE booking_capacity_overrides SET deleted_at = NULL, deleted_by_staff_id = NULL WHERE id = ?').bind(undo.prevId));
  }
  if (statements.length) await db.batch(statements);
});

registerUndo('dog.stay_experience', async (db, log, ctx) => {
  const before = JSON.parse(log.before_value ?? '{}') as { experienced: boolean; at: string | null };
  const after = JSON.parse(log.after_value ?? '{}') as { experienced: boolean };
  const dog = await db.prepare('SELECT stay_experience_at FROM dogs WHERE id = ?').bind(Number(log.target_id)).first<{ stay_experience_at: string | null }>();
  if (!dog || (dog.stay_experience_at !== null) !== after.experienced) {
    throw errors.conflict('dog_changed', 'このワンちゃんの印は、そのあとにまた変えられています。ワンちゃんの画面で直してください。');
  }
  await db
    .prepare('UPDATE dogs SET stay_experience_at = ?, stay_experience_by_staff_id = ? WHERE id = ?')
    .bind(before.experienced ? (before.at ?? toJstIso(ctx.now)) : null, before.experienced ? ctx.staffId : null, Number(log.target_id))
    .run();
});

// 操作ログの画面に出す、変更の中身
const statusText = (s?: BookingStatus) => (s ? BOOKING_STATUS_LABELS[s] : '');
for (const action of ['booking.approve', 'booking.decline', 'booking.check_in', 'booking.complete', 'booking.no_show', 'booking.cancel']) {
  registerAuditDetail(action, (b, a) => (b && a ? `予約 ${statusText(b.status as BookingStatus)} → ${statusText(a.status as BookingStatus)}` : null));
}
const createdText = (_b: Record<string, unknown> | null, a: Record<string, unknown> | null) =>
  a
    ? `${BOOKING_SERVICE_LABELS[a.service as BookingService] ?? ''} ${formatBookingDate(String(a.startDate))}${a.endDate !== a.startDate ? `〜${formatBookingDate(String(a.endDate))}` : ''}・${(a.dogs as string[] | undefined)?.join('・') ?? ''}`
    : null;
registerAuditDetail('booking.create', createdText);
registerAuditDetail('booking.request', createdText);
registerAuditDetail('booking.override', (_b, a) => (a ? (a.closed ? '休みにした' : '受け入れる頭数を変えた') : 'いつもの数に戻した'));
registerAuditDetail('dog.stay_experience', (_b, a) => (a ? `${a.name ?? ''}を「預かり経験あり」${a.experienced ? 'にした' : 'から外した'}` : null));
