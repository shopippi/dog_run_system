// API の応答の型(booking)。預かり・お泊まりの予約(要件定義書 21章)

import type {
  ApprovalReason,
  BookingEstimate,
  BookingNotifyStatus,
  BookingService,
  BookingStatus,
  DayAvailability,
  SizeCounts,
} from './booking';
import type { DogSize } from './constants';
import type { Settings } from './settings';

/** 予約の画面に要る設定(料金・時間・確かめてもらうこと・期限など) */
export type BookingRules = Pick<
  Settings,
  | 'booking_enabled'
  | 'booking_approve_all'
  | 'booking_prices'
  | 'booking_hours'
  | 'booking_cancel_deadline'
  | 'booking_window'
  | 'booking_checklist'
  | 'booking_checklist_required'
  | 'booking_capacity'
  | 'booking_closed_weekdays'
>;

/** 予約に選べるワンちゃん */
export type BookingDogOption = {
  id: number;
  name: string;
  breedName: string;
  size: DogSize;
  thumbUrl: string | null;
  /** 受付でお預かりしたことがある(または「預かり経験あり」の印) */
  experienced: boolean;
  /** 予防注射の案内(止めない)。なければ null */
  vaccineNotice: string | null;
};

/** GET /api/bookings/options */
export type BookingOptionsResponse = {
  today: string;
  rules: BookingRules;
  dogs: BookingDogOption[];
};

/** GET /api/bookings/availability(1日ずつ) */
export type BookingAvailabilityResponse = {
  service: BookingService;
  days: { date: string; status: DayAvailability }[];
};

/** 予約のワンちゃん */
export type BookingDogView = {
  id: number;
  name: string;
  breedName: string;
  size: DogSize;
  thumbUrl: string | null;
  /** 予約したときに、はじめてのワンちゃんだったか */
  firstTime: boolean;
};

/** 予約の一覧の1件 */
export type BookingSummary = {
  id: number;
  service: BookingService;
  status: BookingStatus;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  dogs: BookingDogView[];
  estimateTotal: number;
  createdAt: string;
};

/** お客さん向けの予約の内容(GET /api/bookings/:id) */
export type BookingDetail = BookingSummary & {
  note: string | null;
  checklist: string[];
  estimate: BookingEstimate;
  approvalReason: ApprovalReason;
  /** お店からの一言(承認・お断りのとき) */
  decisionMessage: string | null;
  /** キャンセルできる期限(日本時間) */
  cancelDeadline: string;
  canCancel: boolean;
  /** 申し込んだ家族(LINEの名前) */
  requestedBy: string | null;
  cancelledAt: string | null;
};

/** GET /api/bookings */
export type MyBookingsResponse = { upcoming: BookingSummary[]; past: BookingSummary[] };

// ---- 管理画面 ----

/** その日の受け入れ数と、使っている数 */
export type BookingDayCounts = {
  date: string;
  closed: boolean;
  closedReason: string | null;
  overridden: boolean;
  caps: SizeCounts;
  used: SizeCounts;
  /** その日の予約の数(確認待ちを含む。お泊まりはチェックアウトの日も含む) */
  bookings: number;
  pending: number;
};

/** GET /admin/api/bookings/calendar */
export type BookingCalendarResponse = { service: BookingService; days: BookingDayCounts[]; pendingTotal: number };

/** お知らせの記録 */
export type BookingNotificationView = {
  id: number;
  kind: 'confirmed' | 'declined';
  status: BookingNotifyStatus;
  reason: string | null;
  /** 画面に出す言葉 */
  reasonText: string | null;
  message: string;
  createdAt: string;
};

/** 管理画面の予約の1件 */
export type AdminBookingRow = BookingSummary & {
  householdId: number;
  memberNo: string;
  householdName: string;
  note: string | null;
  staffNote: string | null;
  source: 'customer' | 'staff';
  approvalReason: ApprovalReason;
  requestedBy: string | null;
};

/** GET /admin/api/bookings/:id */
export type AdminBookingDetail = AdminBookingRow & {
  checklist: string[];
  estimate: BookingEstimate;
  decisionMessage: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  capacityOverrideReason: string | null;
  checkedInAt: string | null;
  completedAt: string | null;
  notifications: BookingNotificationView[];
  /** 受付で取れる操作 */
  actions: ('approve' | 'decline' | 'check_in' | 'complete' | 'no_show' | 'cancel')[];
};

/** GET /admin/api/bookings/day */
export type BookingDayResponse = {
  date: string;
  service: BookingService;
  counts: BookingDayCounts;
  override: {
    closed: boolean;
    caps: { small: number | null; medium: number | null; large: number | null };
    note: string | null;
  } | null;
  bookings: AdminBookingRow[];
};

/** GET /admin/api/bookings?status=pending など */
export type AdminBookingListResponse = { bookings: AdminBookingRow[] };

/** 変更の結果(状態の変更・承認など)。auditId はトーストの「元に戻す」 */
export type AdminBookingSaved = { booking: AdminBookingDetail; auditId: number | null };

/** 受け入れ数を超えるときの知らせ(409 booking_full の details) */
export type BookingFullDetails = { dates: { date: string; size: DogSize; caps: number; used: number; need: number }[] };
