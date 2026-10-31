import { z } from 'zod';

// 入力チェック(booking)。預かり・お泊まりの予約(要件定義書 21章、C-15・C-16・A-18〜A-22)

const DATE_MESSAGE = '日にちを選び直してください。';
const dateSchema = z
  .string({ error: DATE_MESSAGE })
  .regex(/^(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, { error: DATE_MESSAGE })
  .refine(
    (d) => {
      const t = new Date(`${d}T00:00:00Z`);
      return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
    },
    { error: DATE_MESSAGE },
  );
const timeSchema = z.string({ error: '時刻を選んでください。' }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: '時刻を選び直してください。' });
const serviceSchema = z.enum(['daycare', 'boarding'], { error: '預かりかお泊まりかを選んでください。' });
const dogIdsSchema = z
  .array(z.number().int().positive(), { error: 'ワンちゃんを選んでください。' })
  .min(1, { error: 'ワンちゃんを1頭以上選んでください。' })
  .max(10, { error: '一度に予約できるのは10頭までです。' })
  .transform((xs) => [...new Set(xs)]);

export const BOOKING_NOTE_MAX = 500;
export const BOOKING_MESSAGE_MAX = 300;

const noteSchema = z
  .string()
  .trim()
  .max(BOOKING_NOTE_MAX, { error: `お店へのメモは${BOOKING_NOTE_MAX}文字までで入力してください。` })
  .nullish()
  .transform((v) => (v ? v : null));

const bookingDatesShape = {
  service: serviceSchema,
  startDate: dateSchema,
  endDate: dateSchema,
  startTime: timeSchema,
  endTime: timeSchema,
};

/** お客さんの予約(POST /api/bookings) */
export const bookingRequestSchema = z.object({
  ...bookingDatesShape,
  dogIds: dogIdsSchema,
  note: noteSchema,
  /** 印を付けた「確かめてもらうこと」(文そのもの) */
  checklist: z.array(z.string().max(80)).max(10).default([]),
});
export type BookingRequestInput = z.infer<typeof bookingRequestSchema>;

/** 空きの問い合わせ(GET /api/bookings/availability・GET /admin/api/bookings/availability) */
export const bookingAvailabilityQuerySchema = z
  .object({
    service: serviceSchema,
    from: dateSchema,
    to: dateSchema,
    dogIds: z
      .string()
      .regex(/^\d+(,\d+){0,9}$/, { error: 'ワンちゃんを選び直してください。' })
      .transform((s) => [...new Set(s.split(',').map(Number))]),
  })
  .refine((v) => v.from <= v.to, { error: '期間を選び直してください。' })
  .refine((v) => new Date(v.to).getTime() - new Date(v.from).getTime() <= 92 * 86400000, {
    error: '一度に見られるのは3か月までです。',
  });

/** 受付での手入力(POST /admin/api/bookings)。電話・DM で受けた予約 */
export const bookingManualSchema = z.object({
  ...bookingDatesShape,
  householdId: z.number({ error: 'おうちを選んでください。' }).int().positive(),
  dogIds: dogIdsSchema,
  note: noteSchema,
  staffNote: z
    .string()
    .trim()
    .max(BOOKING_NOTE_MAX, { error: `受付のメモは${BOOKING_NOTE_MAX}文字までで入力してください。` })
    .nullish()
    .transform((v) => (v ? v : null)),
  /** いっぱいの日でも入れる理由(管理者だけ) */
  overrideReason: z
    .string()
    .trim()
    .max(200, { error: '理由は200文字までで入力してください。' })
    .nullish()
    .transform((v) => (v ? v : null)),
});
export type BookingManualInput = z.infer<typeof bookingManualSchema>;

/** 承認・お断り(お客さんへの一言は任意) */
export const bookingDecisionSchema = z.object({
  message: z
    .string()
    .trim()
    .max(BOOKING_MESSAGE_MAX, { error: `お客さんへの一言は${BOOKING_MESSAGE_MAX}文字までで入力してください。` })
    .nullish()
    .transform((v) => (v ? v : null)),
});

/** 受付でのキャンセル(理由は必須) */
export const bookingCancelSchema = z.object({
  reason: z
    .string({ error: 'キャンセルの理由を入力してください。' })
    .trim()
    .min(1, { error: 'キャンセルの理由を入力してください。' })
    .max(200, { error: '理由は200文字までで入力してください。' }),
});

const capSchema = z.number().int().min(0, { error: '頭数は0〜100で入れてください。' }).max(100, { error: '頭数は0〜100で入れてください。' }).nullable();

/** その日の受け入れ数を変える(PUT /admin/api/bookings/overrides)。reset: true でいつもの数に戻す */
export const capacityOverrideSchema = z.object({
  date: dateSchema,
  service: serviceSchema,
  reset: z.boolean().default(false),
  closed: z.boolean().default(false),
  caps: z.object({ small: capSchema, medium: capSchema, large: capSchema }).default({ small: null, medium: null, large: null }),
  note: z
    .string()
    .trim()
    .max(100, { error: 'メモは100文字までで入力してください。' })
    .nullish()
    .transform((v) => (v ? v : null)),
});
export type CapacityOverrideInput = z.infer<typeof capacityOverrideSchema>;

/** 管理画面の予約カレンダー(GET /admin/api/bookings/calendar?service=&from=&to=) */
export const bookingCalendarQuerySchema = z
  .object({ service: serviceSchema, from: dateSchema, to: dateSchema })
  .refine((v) => v.from <= v.to, { error: '期間を選び直してください。' })
  .refine((v) => new Date(v.to).getTime() - new Date(v.from).getTime() <= 62 * 86400000, { error: '一度に見られるのは2か月までです。' });

/** 預かり経験ありの印(POST /admin/api/dogs/:id/stay-experience) */
export const stayExperienceSchema = z.object({ experienced: z.boolean() });
