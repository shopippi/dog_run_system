// 預かり・お泊まりの予約(要件定義書 21章。2026-10-31)。
// 受け入れ数(サイズごと)・空き・料金の目安・キャンセルの期限・確認待ちにするか・予防注射の案内の決まり。
// API(apps/api)と画面(apps/liff・apps/admin)とデモで同じ決まりを使う。

import { addDays, toJstDate, weekdayOf } from './date';
import { DOG_SIZES, DOG_SIZE_LABELS, type DogSize } from './constants';
import type { Settings } from './settings';

export const BOOKING_SERVICES = ['daycare', 'boarding'] as const;
export type BookingService = (typeof BOOKING_SERVICES)[number];
export const BOOKING_SERVICE_LABELS: Record<BookingService, string> = {
  daycare: '預かり',
  boarding: 'お泊まり',
};

/**
 * 予約の状態。
 * pending 確認待ち / confirmed 確定 / declined お断り / cancelled キャンセル /
 * checked_in お預かり中(利用開始) / completed 利用済み / no_show 来なかった
 */
export const BOOKING_STATUSES = ['pending', 'confirmed', 'declined', 'cancelled', 'checked_in', 'completed', 'no_show'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
/** 管理画面の言葉 */
export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending: '確認待ち',
  confirmed: '確定',
  declined: 'お断り',
  cancelled: 'キャンセル',
  checked_in: 'お預かり中',
  completed: '利用済み',
  no_show: '来なかった',
};
/** お客さん向けの言葉 */
export const BOOKING_STATUS_LABELS_CUSTOMER: Record<BookingStatus, string> = {
  ...BOOKING_STATUS_LABELS,
  no_show: 'ご来店なし',
};
/** 受け入れ数を使う状態(確認待ちも枠を押さえる。お断り・キャンセル・来なかったは枠を空ける) */
export const BOOKING_HOLDING_STATUSES: readonly BookingStatus[] = ['pending', 'confirmed', 'checked_in', 'completed'];
/** 「預かり経験あり」になる状態(一度でも受付でお預かりした) */
export const BOOKING_STAYED_STATUSES: readonly BookingStatus[] = ['checked_in', 'completed'];

export type SizeCounts = Record<DogSize, number>;
export const zeroCounts = (): SizeCounts => ({ small: 0, medium: 0, large: 0 });

/** その日・そのサービスの受け入れ数の上書き(管理画面のカレンダーで変える) */
export type CapacityOverride = {
  date: string;
  service: BookingService;
  closed: boolean;
  /** null はいつもの数 */
  caps: { small: number | null; medium: number | null; large: number | null };
  note: string | null;
};

/** その日の受け入れ数(いつもの数・定休日・臨時休業・上書きから決める) */
export type DayCapacity = { closed: boolean; closedReason: string | null; caps: SizeCounts; overridden: boolean };

/**
 * その日の受け入れ数。
 * - 臨時休業(イベント・休業日 A-09)の日は、どちらのサービスも休み(上書きより強い)
 * - 上書きがあれば、それに従う(休みにする・数を変える。定休日でも数を入れればその日だけ受ける)
 * - 上書きがなく、定休日(予約を受けない曜日)なら休み
 * - それ以外はいつもの数
 */
export function capacityFor(
  settings: Pick<Settings, 'booking_capacity' | 'booking_closed_weekdays'>,
  service: BookingService,
  date: string,
  opts: { shopClosed?: boolean; shopClosedNote?: string | null; override?: CapacityOverride | null } = {},
): DayCapacity {
  const base = settings.booking_capacity[service];
  if (opts.shopClosed) return { closed: true, closedReason: opts.shopClosedNote || '臨時休業', caps: zeroCounts(), overridden: false };
  const o = opts.override;
  if (o) {
    if (o.closed) return { closed: true, closedReason: o.note || '休み', caps: zeroCounts(), overridden: true };
    return {
      closed: false,
      closedReason: null,
      caps: { small: o.caps.small ?? base.small, medium: o.caps.medium ?? base.medium, large: o.caps.large ?? base.large },
      overridden: true,
    };
  }
  if (settings.booking_closed_weekdays.includes(weekdayOf(date))) {
    return { closed: true, closedReason: '定休日', caps: zeroCounts(), overridden: false };
  }
  return { closed: false, closedReason: null, caps: { ...base }, overridden: false };
}

/**
 * 予約が受け入れ数を使う日(含む)。
 * 預かりはその日だけ。お泊まりは、泊まる夜(チェックインの日 〜 チェックアウトの前の日)。
 */
export function occupiedRange(service: BookingService, startDate: string, endDate: string): { from: string; to: string } {
  if (service === 'daycare') return { from: startDate, to: startDate };
  return { from: startDate, to: addDays(endDate, -1) };
}

/** from から to までの日付(両端を含む) */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 泊数(お泊まり)。預かりは 0 */
export function nightsOf(service: BookingService, startDate: string, endDate: string): number {
  if (service === 'daycare') return 0;
  return datesBetween(startDate, endDate).length - 1;
}

/** 選んだワンちゃんのサイズごとの頭数 */
export function countBySize(sizes: readonly DogSize[]): SizeCounts {
  const c = zeroCounts();
  for (const s of sizes) c[s] += 1;
  return c;
}

/** カレンダーの1日の見え方(お客さん向け) */
export type DayAvailability = 'open' | 'few' | 'full' | 'closed' | 'out';
export const DAY_AVAILABILITY_LABELS: Record<DayAvailability, string> = {
  open: '空きあり',
  few: '残りわずか',
  full: '満員',
  closed: '休み',
  out: '受付期間外',
};

/**
 * 選んだワンちゃん(サイズごとの頭数 need)で、その日がどう見えるか。
 * - 休み: 受け入れ数の上書きで休み・定休日・臨時休業
 * - 満員: どれかのサイズで、残りが選んだ頭数より少ない
 * - 残りわずか: どれかのサイズで、残りが 1 以下(選んだ頭数ぶんは入る)
 * - 空きあり: それ以外
 */
export function dayAvailability(cap: DayCapacity, used: SizeCounts, need: SizeCounts): DayAvailability {
  if (cap.closed) return 'closed';
  let few = false;
  for (const s of DOG_SIZES) {
    if (need[s] === 0) continue;
    const remaining = cap.caps[s] - used[s];
    if (remaining < need[s]) return 'full';
    if (remaining <= 1) few = true;
  }
  return few ? 'few' : 'open';
}

/** 予約できる期間(今日から min 日後 〜 max 日後) */
export function bookingWindow(settings: Pick<Settings, 'booking_window'>, today: string): { first: string; last: string } {
  return {
    first: addDays(today, settings.booking_window.min_days_ahead),
    last: addDays(today, settings.booking_window.max_days_ahead),
  };
}

/** "09:30" → 分 */
export const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** 料金の目安の1行 */
export type EstimateLine = { dogId: number | null; dogName: string; size: DogSize; label: string; unit: number; qty: number; amount: number };
export type BookingEstimate = { total: number; lines: EstimateLine[]; halfDay: boolean; nights: number };

/**
 * 料金の目安(お支払いは受付で)。
 * - 預かり: 1日の料金。半日を使う設定で、預ける時間が max_hours 以内なら半日の料金
 * - お泊まり: 1泊の料金 × 泊数
 * ワンちゃんごとに1行。
 */
export function estimateBooking(
  settings: Pick<Settings, 'booking_prices'>,
  input: {
    service: BookingService;
    startDate: string;
    endDate: string;
    startTime: string;
    endTime: string;
    dogs: readonly { id: number | null; name: string; size: DogSize }[];
  },
): BookingEstimate {
  const p = settings.booking_prices;
  const nights = nightsOf(input.service, input.startDate, input.endDate);
  const halfDay =
    input.service === 'daycare' &&
    p.half_day.enabled &&
    minutesOf(input.endTime) - minutesOf(input.startTime) <= p.half_day.max_hours * 60;
  const lines: EstimateLine[] = input.dogs.map((d) => {
    const sizeLabel = DOG_SIZE_LABELS[d.size];
    if (input.service === 'daycare') {
      const unit = halfDay ? p.half_day.price[d.size] : p.daycare[d.size];
      return { dogId: d.id, dogName: d.name, size: d.size, label: `${halfDay ? '預かり(半日)' : '預かり(1日)'}・${sizeLabel}`, unit, qty: 1, amount: unit };
    }
    const unit = p.boarding[d.size];
    return { dogId: d.id, dogName: d.name, size: d.size, label: `お泊まり・${sizeLabel}`, unit, qty: nights, amount: unit * nights };
  });
  return { total: lines.reduce((n, l) => n + l.amount, 0), lines, halfDay, nights };
}

/** 料金の表示("3,000円") */
export const yen = (n: number): string => `${n.toLocaleString('ja-JP')}円`;

/** 料金の目安に添える言葉(画面に必ず出す) */
export const ESTIMATE_NOTE = '目安。お支払いは受付で';

/**
 * お客さんがキャンセルできる期限(日本時間の日時)。利用の初日の days_before 日前の time。
 * 例: 初日 11月3日、1日前の 18:00 → 11月2日 18:00
 */
export function cancelDeadline(settings: Pick<Settings, 'booking_cancel_deadline'>, startDate: string): string {
  const d = addDays(startDate, -settings.booking_cancel_deadline.days_before);
  return `${d}T${settings.booking_cancel_deadline.time}:00+09:00`;
}

/** いまキャンセルできるか(状態と期限) */
export function canCustomerCancel(
  settings: Pick<Settings, 'booking_cancel_deadline'>,
  booking: { status: BookingStatus; startDate: string },
  now: Date,
): boolean {
  if (booking.status !== 'pending' && booking.status !== 'confirmed') return false;
  return now.getTime() <= new Date(cancelDeadline(settings, booking.startDate)).getTime();
}

/** 確認待ちにする理由。null ならすぐ確定 */
export type ApprovalReason = 'first_time' | 'approve_all' | null;

/**
 * すぐ確定するか、確認待ちにするか(2026-10-31 の決定)。
 * - 「すべて承認制にする」が on なら、すべて確認待ち
 * - はじめてのワンちゃん(預かりもお泊まりも、受付でお預かりしたことがない。「預かり経験あり」の印もない)がいれば確認待ち
 * - それ以外はすぐ確定
 */
export function approvalReason(approveAll: boolean, dogs: readonly { experienced: boolean }[]): ApprovalReason {
  if (approveAll) return 'approve_all';
  if (dogs.some((d) => !d.experienced)) return 'first_time';
  return null;
}

/**
 * 予防注射の案内(止めない。やさしく知らせるだけ)。
 * 狂犬病・混合ワクチンの年が空欄か、去年より前なら、その子の名前つきで一言。
 */
export function vaccineNotice(
  dog: { name: string; rabiesVaccineYear: number | null; comboVaccineYear: number | null },
  today: string,
): string | null {
  const year = Number(today.slice(0, 4));
  const missing: string[] = [];
  const old: string[] = [];
  const check = (label: string, y: number | null) => {
    if (y == null) missing.push(label);
    else if (y < year - 1) old.push(label);
  };
  check('狂犬病の予防注射', dog.rabiesVaccineYear);
  check('混合ワクチン', dog.comboVaccineYear);
  if (missing.length === 0 && old.length === 0) return null;
  const parts: string[] = [];
  if (missing.length) parts.push(`${missing.join('・')}の年が登録されていません`);
  if (old.length) parts.push(`${old.join('・')}の年が前の年より前になっています`);
  return `${dog.name}は、${parts.join('。')}。接種の証明書を受付でお見せいただけると安心です(ワンちゃんの情報からも登録できます)。`;
}

/** 予約の入力の確かめ(サーバーと画面で同じ)。だめなときは、何をどう直せばよいかの日本語 */
export function checkBookingDates(
  settings: Pick<Settings, 'booking_hours' | 'booking_window'>,
  input: { service: BookingService; startDate: string; endDate: string; startTime: string; endTime: string },
  today: string,
  opts: { ignoreWindow?: boolean } = {},
): string | null {
  const { open, close } = settings.booking_hours;
  const inHours = (t: string) => t >= open && t <= close;
  if (!inHours(input.startTime) || !inHours(input.endTime)) {
    return `時刻は、${open}〜${close}のあいだで選んでください。`;
  }
  if (input.service === 'daycare') {
    if (input.endDate !== input.startDate) return '預かりは1日ずつ予約してください。';
    if (input.endTime <= input.startTime) return 'お迎えの時刻は、預ける時刻より後にしてください。';
  } else {
    if (input.endDate <= input.startDate) return 'チェックアウトの日は、チェックインの日より後にしてください。';
    const nights = nightsOf('boarding', input.startDate, input.endDate);
    if (nights > settings.booking_window.max_nights) return `お泊まりは${settings.booking_window.max_nights}泊までです。それより長いときは、お店にご相談ください。`;
  }
  if (opts.ignoreWindow) {
    // 受付の手入力: 今日と、お客さんの予約できる期間より前の日も入れられる(過ぎた日だけはだめ)
    if (input.startDate < today) return '過ぎた日には予約を入れられません。日にちを選び直してください。';
  } else {
    const w = bookingWindow(settings, today);
    if (input.startDate < w.first) {
      return settings.booking_window.min_days_ahead === 0
        ? '過ぎた日は予約できません。'
        : `予約は${settings.booking_window.min_days_ahead}日後からです。それより前は、お店に直接ご連絡ください。`;
    }
    if (input.startDate > w.last) return `予約は${settings.booking_window.max_days_ahead}日後までです。`;
  }
  return null;
}

/** "2026-11-03" → "11月3日(火)" */
export function formatBookingDate(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return `${m}月${d}日(${'日月火水木金土'[weekdayOf(ymd)]})`;
}

/** 予約の日付の一行(「11月3日(火) 9:00〜17:00」「11月3日(火) 10:00 〜 11月5日(木) 16:00・2泊」) */
export function bookingWhenText(b: { service: BookingService; startDate: string; endDate: string; startTime: string; endTime: string }): string {
  const t = (s: string) => s.replace(/^0/, '');
  if (b.service === 'daycare') return `${formatBookingDate(b.startDate)} ${t(b.startTime)}〜${t(b.endTime)}`;
  const n = nightsOf('boarding', b.startDate, b.endDate);
  return `${formatBookingDate(b.startDate)} ${t(b.startTime)} 〜 ${formatBookingDate(b.endDate)} ${t(b.endTime)}・${n}泊`;
}

/** 選べる時刻(30分ごと。受付の時間の中) */
export function timeOptions(settings: Pick<Settings, 'booking_hours'>, stepMinutes = 30): string[] {
  const out: string[] = [];
  const pad = (n: number) => String(n).padStart(2, '0');
  for (let m = minutesOf(settings.booking_hours.open); m <= minutesOf(settings.booking_hours.close); m += stepMinutes) {
    out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  }
  return out;
}

/** その月の LINE のお知らせを数える月("2026-10") */
export const bookingMonthOf = (now: Date): string => toJstDate(now).slice(0, 7);

/** 予約のお知らせ(LINE)の本文。確定・お断り。テキストだけ(Flex は使わない。通数は同じ) */
export function bookingMessageText(args: {
  kind: 'confirmed' | 'declined';
  facilityName: string;
  service: BookingService;
  when: string;
  dogNames: string[];
  estimateTotal: number;
  message: string | null;
  link: string | null;
}): string {
  const lines: string[] = [];
  const svc = BOOKING_SERVICE_LABELS[args.service];
  if (args.kind === 'confirmed') {
    lines.push(`【${args.facilityName}】${svc}のご予約が確定しました。`);
  } else {
    lines.push(`【${args.facilityName}】申し訳ありません。${svc}のご予約をお受けできませんでした。`);
  }
  lines.push('');
  lines.push(`日にち: ${args.when}`);
  lines.push(`ワンちゃん: ${args.dogNames.join('・')}`);
  if (args.kind === 'confirmed') lines.push(`料金の目安: ${yen(args.estimateTotal)}(${ESTIMATE_NOTE})`);
  if (args.message) {
    lines.push('');
    lines.push(`お店から: ${args.message}`);
  }
  if (args.link) {
    lines.push('');
    lines.push(`予約の内容: ${args.link}`);
  }
  return lines.join('\n');
}

/** 予約のお知らせの記録の状態 */
export const BOOKING_NOTIFY_STATUSES = ['sent', 'skipped', 'failed'] as const;
export type BookingNotifyStatus = (typeof BOOKING_NOTIFY_STATUSES)[number];
export const BOOKING_NOTIFY_REASON_LABELS: Record<string, string> = {
  no_token: 'LINEのお知らせの設定がまだのため、送っていません',
  disabled: 'ルールでお知らせを送らない設定のため、送っていません',
  monthly_limit: 'ひと月に送る数の上限に達したため、送っていません',
  no_recipient: '送り先のLINEアカウントがおうちにいないため、送っていません',
  manual_entry: '受付で入れた予約のため、送っていません',
  mock: '練習用の環境のため、実際には送っていません',
  not_friend: 'お客さんがLINEの友だちに追加していないため、届きませんでした',
  http_error: 'LINEに送れませんでした',
  network: 'LINEにつながりませんでした',
};

/** 日本時間の「いま」から見た、利用の初日まで(画面の並べ替え用) */
export const isUpcoming = (b: { status: BookingStatus; endDate: string }, today: string): boolean =>
  b.endDate >= today && (b.status === 'pending' || b.status === 'confirmed' || b.status === 'checked_in');

/** その日の預け・お迎えの1件(お店の1日の予定。21.5) */
export type ScheduleItem = {
  bookingId: number;
  time: string;
  /** dropoff 預け / pickup お迎え / checkin チェックイン / checkout チェックアウト */
  kind: 'dropoff' | 'pickup' | 'checkin' | 'checkout';
};
export const SCHEDULE_KIND_LABELS: Record<ScheduleItem['kind'], string> = {
  dropoff: '預け',
  pickup: 'お迎え',
  checkin: 'お泊まりの預け(チェックイン)',
  checkout: 'お泊まりのお迎え(チェックアウト)',
};

/**
 * その日の預け・お迎えを時刻の順に並べる。お断り・キャンセル・来なかったは出さない。
 * 預かりは預けとお迎えの2件、お泊まりはチェックインの日とチェックアウトの日にだけ出す(泊まっている途中の日は出さない)
 */
export function scheduleOf(
  bookings: readonly { id: number; service: BookingService; status: BookingStatus; startDate: string; endDate: string; startTime: string; endTime: string }[],
  date: string,
): ScheduleItem[] {
  const out: ScheduleItem[] = [];
  for (const b of bookings) {
    if (b.status === 'declined' || b.status === 'cancelled' || b.status === 'no_show') continue;
    if (b.service === 'daycare') {
      if (b.startDate !== date) continue;
      out.push({ bookingId: b.id, time: b.startTime, kind: 'dropoff' }, { bookingId: b.id, time: b.endTime, kind: 'pickup' });
    } else {
      if (b.startDate === date) out.push({ bookingId: b.id, time: b.startTime, kind: 'checkin' });
      if (b.endDate === date) out.push({ bookingId: b.id, time: b.endTime, kind: 'checkout' });
    }
  }
  const order = { checkout: 0, pickup: 1, checkin: 2, dropoff: 3 } as const;
  return out.sort((a, b) => a.time.localeCompare(b.time) || order[a.kind] - order[b.kind] || a.bookingId - b.bookingId);
}

/** 予約の画面の上に出す、預け・お迎えの時間と定休日の一行(「預け・お迎え 9:00〜18:00 / 定休日 なし」) */
export function bookingHoursText(settings: Pick<Settings, 'booking_hours' | 'booking_closed_weekdays'>): string {
  const t = (x: string) => x.replace(/^0/, '');
  const days = [...settings.booking_closed_weekdays].sort().map((d) => '日月火水木金土'[d]).join('・');
  return `預け・お迎え ${t(settings.booking_hours.open)}〜${t(settings.booking_hours.close)} / 定休日 ${days ? `${days}曜` : 'なし'}`;
}
