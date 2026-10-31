import {
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
import { requireMember } from '../../services/members';
import { MEDIA_BASE } from './media';

// C-15 予約する・C-16 予約の一覧とキャンセル(要件定義書 21章)。
// LINE の IDトークンは app.ts の requireLineUser が毎回確かめる。送信の印(Idempotency-Key)で二重に予約しない。
export const bookingRoutes = new Hono<AppEnv>();

export function bookingRules(s: Settings): BookingRules {
  return {
    booking_enabled: s.booking_enabled,
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

// 予約する(C-15)。経験のある子だけならすぐ確定、はじめての子がいれば確認待ち
bookingRoutes.post('/bookings', async (c) => {
  const db = c.env.DB;
  const member = await requireMember(db, c.get('lineUser').userId);
  const input = await parseJson(c, bookingRequestSchema);
  const settings = await loadSettings(db);
  if (!settings.booking_enabled) {
    throw errors.conflict('booking_disabled', 'いまはLINEからの予約を受け付けていません。お店に直接ご連絡ください。');
  }
  if (settings.booking_checklist_required && settings.booking_checklist.some((x) => !input.checklist.includes(x))) {
    throw errors.badRequest('「予約の前に確かめてください」のすべてに印を付けてください。');
  }
  const now = c.get('now');
  const id = await createBooking(db, settings, {
    ...input,
    householdId: member.householdId,
    source: 'customer',
    memberId: member.memberId,
    staffId: null,
    now,
  });
  const detail = await detailFor(db, id, settings, now);
  // すぐ確定したときだけ、LINE で知らせる(失敗しても予約はそのまま)
  if (detail.status === 'confirmed') await notifyBooking(c.env, id, 'confirmed', now);
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
