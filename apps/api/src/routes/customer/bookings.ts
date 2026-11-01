import {
  IDEMPOTENCY_KEY_RE,
  bookingAvailabilityQuerySchema,
  bookingRequestSchema,
  bookingWindow,
  countBySize,
  dayAvailability,
  isUpcoming,
  toJstDate,
  vaccineNotice,
  type BookingAvailabilityResponse,
  type BookingDetail,
  type BookingOptionsResponse,
  type BookingRules,
  type MyBookingsResponse,
  type Settings,
} from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { loadSettings } from '../../lib/settings';
import { parseInput, parseJson } from '../../lib/validate';
import {
  bookingBelongsTo,
  bookingDogs,
  capacitiesFor,
  createBooking,
  customerList,
  experiencedDogIds,
  findBooking,
  householdActiveDogs,
  pickDogs,
  toCustomerDetail,
  toSummary,
  transitionBooking,
  usedFor,
} from '../../services/bookings';
import { notifyBooking } from '../../services/line-push';
import { userHashOf } from '../../lib/idempotency';
import { requireMember } from '../../services/members';
import { MEDIA_BASE } from './media';

// C-15 予約する・C-16 予約の一覧とキャンセル(要件定義書 21章)。
// LINE の IDトークンは app.ts の requireLineUser が毎回確かめる。送信の印(Idempotency-Key)で二重に予約しない。
export const bookingRoutes = new Hono<AppEnv>();

export function bookingRules(s: Settings): BookingRules {
  return {
    booking_enabled: s.booking_enabled,
    booking_daily_limit: s.booking_daily_limit,
    booking_approve_all: s.booking_approve_all,
    booking_prices: s.booking_prices,
    booking_hours: s.booking_hours,
    booking_cancel_deadline: s.booking_cancel_deadline,
    booking_window: s.booking_window,
    booking_checklist: s.booking_checklist,
    booking_checklist_required: s.booking_checklist_required,
    booking_capacity: s.booking_capacity,
    booking_closed_weekdays: s.booking_closed_weekdays,
  };
}

async function detailFor(db: D1Database, id: number, settings: Settings, now: Date): Promise<BookingDetail> {
  const row = await findBooking(db, id);
  const dogs = (await bookingDogs(db, [row.id], MEDIA_BASE)).get(row.id) ?? [];
  return toCustomerDetail(row, dogs, settings, now);
}

// 予約の画面に要る設定と、選べるワンちゃん(予約の経験・予防注射の案内つき)
bookingRoutes.get('/bookings/options', async (c) => {
  const db = c.env.DB;
  const member = await requireMember(db, c.get('lineUser').userId);
  const settings = await loadSettings(db);
  const today = toJstDate(c.get('now'));
  const dogs = await householdActiveDogs(db, member.householdId);
  const exp = await experiencedDogIds(db, dogs.map((d) => d.id));
  const body: BookingOptionsResponse = {
    today,
    rules: bookingRules(settings),
    dogs: dogs.map((d) => ({
      id: d.id,
      name: d.name,
      breedName: d.breed_name,
      size: d.size,
      thumbUrl: d.thumb_key ? `${MEDIA_BASE}/${d.thumb_key}` : null,
      experienced: exp.has(d.id),
      vaccineNotice: vaccineNotice(
        { name: d.name, rabiesVaccineYear: d.rabies_vaccine_year, comboVaccineYear: d.combo_vaccine_year },
        today,
      ),
    })),
  };
  return c.json(body);
});

// 空き(選んだワンちゃんのサイズで、1日ずつ: 空きあり・残りわずか・満員・休み・受付期間外)
bookingRoutes.get('/bookings/availability', async (c) => {
  const db = c.env.DB;
  const member = await requireMember(db, c.get('lineUser').userId);
  const q = parseInput(bookingAvailabilityQuerySchema, c.req.query());
  const settings = await loadSettings(db);
  const dogs = await pickDogs(db, member.householdId, q.dogIds);
  const need = countBySize(dogs.map((d) => d.size));
  const caps = await capacitiesFor(db, settings, q.service, q.from, q.to);
  const used = await usedFor(db, q.service, q.from, q.to);
  const w = bookingWindow(settings, toJstDate(c.get('now')));
  const body: BookingAvailabilityResponse = {
    service: q.service,
    days: [...caps.entries()].map(([date, cap]) => ({
      date,
      status: !settings.booking_enabled || date < w.first || date > w.last ? 'out' : dayAvailability(cap, used.get(date)!, need),
    })),
  };
  return c.json(body);
});

/**
 * 1日にできる予約とキャンセルの回数(おうちごと。設定 booking_daily_limit)。くり返して LINE のお知らせの月の上限を使い切らないように
 */
async function assertDailyLimit(db: D1Database, householdId: number, settings: Settings, now: Date) {
  const today = toJstDate(now);
  const r = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM bookings WHERE household_id = ?1 AND source = 'customer' AND substr(created_at, 1, 10) = ?2)
            + (SELECT COUNT(*) FROM bookings WHERE household_id = ?1 AND cancelled_by_type = 'member' AND substr(cancelled_at, 1, 10) = ?2) AS n`,
    )
    .bind(householdId, today)
    .first<{ n: number }>();
  if ((r?.n ?? 0) >= settings.booking_daily_limit) {
    throw errors.conflict(
      'booking_daily_limit',
      '今日は予約とキャンセルの回数が多いため、これ以上はできません。明日もう一度お試しいただくか、お店に直接ご連絡ください。',
    );
  }
}

/** 同じ送信の印で入った予約(応答が届かずに送り直したとき)。あれば、その予約を返す */
async function bookingForRequestKey(db: D1Database, requestKey: string | null, householdId: number): Promise<number | null> {
  if (!requestKey) return null;
  const r = await db.prepare('SELECT id FROM bookings WHERE request_key = ? AND household_id = ?').bind(requestKey, householdId).first<{ id: number }>();
  return r?.id ?? null;
}

/** すぐ確定した予約の LINE のお知らせを、まだ記録していなければ送る(送り直しで二重に送らない) */
async function notifyConfirmedOnce(env: AppEnv['Bindings'], bookingId: number, now: Date) {
  const sent = await env.DB.prepare("SELECT 1 AS x FROM booking_notifications WHERE booking_id = ? AND kind = 'confirmed' LIMIT 1")
    .bind(bookingId)
    .first();
  if (!sent) await notifyBooking(env, bookingId, 'confirmed', now);
}

// 予約する(C-15)。経験のある子だけならすぐ確定、はじめての子がいれば確認待ち
bookingRoutes.post('/bookings', async (c) => {
  const db = c.env.DB;
  const member = await requireMember(db, c.get('lineUser').userId);
  const input = await parseJson(c, bookingRequestSchema);
  const settings = await loadSettings(db);
  const now = c.get('now');
  // 予約は入ったのに応答が届かず、同じ送信の印で送り直されたときは、その予約を返す(お知らせも1回だけ)
  const key = c.req.header('idempotency-key');
  const requestKey = key && IDEMPOTENCY_KEY_RE.test(key) ? `${await userHashOf(c.get('lineUser').userId)}:${key}` : null;
  const existing = await bookingForRequestKey(db, requestKey, member.householdId);
  if (existing) {
    const detail = await detailFor(db, existing, settings, now);
    if (detail.status === 'confirmed') await notifyConfirmedOnce(c.env, existing, now);
    return c.json(detail, 201);
  }
  if (!settings.booking_enabled) {
    throw errors.conflict('booking_disabled', 'いまはLINEからの予約を受け付けていません。お店に直接ご連絡ください。');
  }
  if (settings.booking_checklist_required && settings.booking_checklist.some((x) => !input.checklist.includes(x))) {
    throw errors.badRequest('「予約の前に確かめてください」のすべてに印を付けてください。');
  }
  await assertDailyLimit(db, member.householdId, settings, now);
  let id: number;
  try {
    id = await createBooking(db, settings, {
      ...input,
      householdId: member.householdId,
      source: 'customer',
      memberId: member.memberId,
      staffId: null,
      requestKey,
      now,
    });
  } catch (e) {
    // 同じ印の予約が、ちょうど同時に入った
    const again = await bookingForRequestKey(db, requestKey, member.householdId);
    if (!again) throw e;
    id = again;
  }
  const detail = await detailFor(db, id, settings, now);
  // すぐ確定したときだけ、LINE で知らせる(失敗しても予約はそのまま。二重に送らない)
  if (detail.status === 'confirmed') await notifyConfirmedOnce(c.env, id, now);
  return c.json(detail, 201);
});

// 予約の一覧(C-16)。これからの予約と、終わった予約
bookingRoutes.get('/bookings', async (c) => {
  const db = c.env.DB;
  const member = await requireMember(db, c.get('lineUser').userId);
  const { rows, dogs } = await customerList(db, member.householdId, MEDIA_BASE);
  const today = toJstDate(c.get('now'));
  const upcoming = rows
    .filter((r) => isUpcoming({ status: r.status, endDate: r.end_date }, today))
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id - b.id);
  const past = rows.filter((r) => !isUpcoming({ status: r.status, endDate: r.end_date }, today));
  const body: MyBookingsResponse = {
    upcoming: upcoming.map((r) => toSummary(r, dogs.get(r.id) ?? [])),
    past: past.map((r) => toSummary(r, dogs.get(r.id) ?? [])),
  };
  return c.json(body);
});

// 予約の内容(LINE のお知らせのリンクからも開く)。自分のおうちの予約だけ
bookingRoutes.get('/bookings/:id', async (c) => {
  const db = c.env.DB;
  const member = await requireMember(db, c.get('lineUser').userId);
  const row = await findBooking(db, Number(c.req.param('id')));
  if (!(await bookingBelongsTo(db, row, member.householdId))) {
    throw errors.notFound('予約が見つかりませんでした。予約の一覧から開き直してください。');
  }
  return c.json(await detailFor(db, row.id, await loadSettings(db), c.get('now')));
});

// キャンセル(C-16)。期限(初期値は前の日の 18:00)まで。過ぎたら、お店に連絡してもらう
bookingRoutes.post('/bookings/:id/cancel', async (c) => {
  const db = c.env.DB;
  const member = await requireMember(db, c.get('lineUser').userId);
  const row = await findBooking(db, Number(c.req.param('id')));
  if (!(await bookingBelongsTo(db, row, member.householdId))) {
    throw errors.notFound('予約が見つかりませんでした。予約の一覧から開き直してください。');
  }
  const settings = await loadSettings(db);
  const now = c.get('now');
  const detail = toCustomerDetail(row, [], settings, now);
  if (row.status === 'cancelled') return c.json(await detailFor(db, row.id, settings, now));
  if (detail.canCancel) await assertDailyLimit(db, member.householdId, settings, now);
  if (!detail.canCancel) {
    throw errors.conflict(
      'cancel_deadline_passed',
      row.status === 'pending' || row.status === 'confirmed'
        ? 'キャンセルの期限を過ぎています。キャンセルするときは、お店に直接ご連絡ください。'
        : 'この予約はキャンセルできない状態です。画面を読み込み直してください。',
    );
  }
  await transitionBooking(db, row, 'cancel', { type: 'member', id: member.memberId }, now, { reason: 'お客さんがキャンセル' });
  return c.json(await detailFor(db, row.id, settings, now));
});
