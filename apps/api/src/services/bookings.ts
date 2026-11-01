import {
  BOOKING_HOLDING_STATUSES,
  BOOKING_NOTIFY_REASON_LABELS,
  BOOKING_STAYED_STATUSES,
  DOG_SIZES,
  addDays,
  approvalReason,
  cancelDeadline,
  canCustomerCancel,
  capacityFor,
  checkBookingDates,
  countBySize,
  datesBetween,
  estimateBooking,
  occupiedRange,
  toJstDate,
  toJstIso,
  zeroCounts,
  type AdminBookingDetail,
  type AdminBookingRow,
  type ApprovalReason,
  type BookingDayCounts,
  type BookingDetail,
  type BookingDogView,
  type BookingEstimate,
  type BookingFullDetails,
  type BookingNotificationView,
  type BookingService,
  type BookingStatus,
  type BookingSummary,
  type CapacityOverride,
  type DayCapacity,
  type DogSize,
  type Settings,
  type SizeCounts,
} from '@dr/shared';
import { AppError, errors } from '../lib/errors';
import { auditStatement } from './audit';
import { MERGED_HOUSEHOLDS_CTE } from './merged-households';

// 預かり・お泊まりの予約(要件定義書 21章)。受け入れ数・空き・予約を入れる・状態を変える。
// - 受け入れ数はサービスごと・サイズごと。確認待ちも枠を押さえる(BOOKING_HOLDING_STATUSES)
// - 最後の1枠を2人が同時に取らないよう、予約を入れる batch の最後で booking_guard の CHECK に計算させる
//   (超えていれば batch 全体が取り消される)
// - 物理削除しない。お断り・キャンセル・来なかったは状態の変更。操作ログ(audit_log)から元に戻せる

const HOLDING_SQL = BOOKING_HOLDING_STATUSES.map((s) => `'${s}'`).join(',');
const STAYED_SQL = BOOKING_STAYED_STATUSES.map((s) => `'${s}'`).join(',');

export type BookingRow = {
  id: number;
  household_id: number;
  service: BookingService;
  status: BookingStatus;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  occupy_from: string;
  occupy_to: string;
  note: string | null;
  checklist: string;
  estimate_total: number;
  estimate_detail: string;
  source: 'customer' | 'staff';
  approval_reason: ApprovalReason;
  requested_by_member_id: number | null;
  created_by_staff_id: number | null;
  staff_note: string | null;
  capacity_override_reason: string | null;
  decided_at: string | null;
  decided_by_staff_id: number | null;
  decision_message: string | null;
  cancelled_at: string | null;
  cancelled_by_type: 'member' | 'staff' | null;
  cancelled_by_id: number | null;
  cancel_reason: string | null;
  checked_in_at: string | null;
  completed_at: string | null;
  no_show_at: string | null;
  created_at: string;
  updated_at: string;
  // 結合した列
  member_no: string;
  household_name: string;
  requested_by: string | null;
  decided_by: string | null;
  owner_names: string | null;
};

const BOOKING_SELECT = `
  SELECT b.*, h.member_no, h.display_name AS household_name, m.line_display_name AS requested_by, ds.name AS decided_by,
         (SELECT GROUP_CONCAT(f.line_display_name, '、') FROM family_members f
           WHERE f.household_id = b.household_id AND f.status = 'active' AND f.line_display_name IS NOT NULL) AS owner_names
    FROM bookings b
    JOIN households h ON h.id = b.household_id
    LEFT JOIN family_members m ON m.id = b.requested_by_member_id
    LEFT JOIN staff_users ds ON ds.id = b.decided_by_staff_id`;

export async function findBooking(db: D1Database, id: number): Promise<BookingRow> {
  const row = Number.isInteger(id) && id > 0 ? await db.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).bind(id).first<BookingRow>() : null;
  if (!row) throw errors.notFound('予約が見つかりませんでした。画面を読み込み直してください。');
  return row;
}

// ---------------------------------------------------------------
// 受け入れ数と、使っている数
// ---------------------------------------------------------------

type OverrideRow = {
  id: number;
  date: string;
  service: BookingService;
  closed: number;
  cap_small: number | null;
  cap_medium: number | null;
  cap_large: number | null;
  note: string | null;
  created_at: string;
};

export const toOverride = (r: OverrideRow): CapacityOverride => ({
  date: r.date,
  service: r.service,
  closed: r.closed === 1,
  caps: { small: r.cap_small, medium: r.cap_medium, large: r.cap_large },
  note: r.note,
});

export async function activeOverride(db: D1Database, service: BookingService, date: string): Promise<OverrideRow | null> {
  return db
    .prepare('SELECT * FROM booking_capacity_overrides WHERE service = ? AND date = ? AND deleted_at IS NULL')
    .bind(service, date)
    .first<OverrideRow>();
}

/** 期間の受け入れ数(いつもの数・定休日・臨時休業・上書き) */
export async function capacitiesFor(
  db: D1Database,
  settings: Settings,
  service: BookingService,
  from: string,
  to: string,
): Promise<Map<string, DayCapacity>> {
  const [overrides, closures] = await db.batch([
    db
      .prepare('SELECT * FROM booking_capacity_overrides WHERE service = ? AND date BETWEEN ? AND ? AND deleted_at IS NULL')
      .bind(service, from, to),
    db.prepare('SELECT date, closed_note FROM calendar WHERE is_closed = 1 AND date BETWEEN ? AND ?').bind(from, to),
  ]);
  const ov = new Map((overrides!.results as OverrideRow[]).map((r) => [r.date, toOverride(r)]));
  const cl = new Map((closures!.results as { date: string; closed_note: string | null }[]).map((r) => [r.date, r.closed_note]));
  const out = new Map<string, DayCapacity>();
  for (const d of datesBetween(from, to)) {
    out.set(d, capacityFor(settings, service, d, { shopClosed: cl.has(d), shopClosedNote: cl.get(d) ?? null, override: ov.get(d) ?? null }));
  }
  return out;
}

/** 期間の、使っている数(サイズごと)。確認待ちを含む。excludeId の予約は数えない(元に戻すときなど) */
export async function usedFor(
  db: D1Database,
  service: BookingService,
  from: string,
  to: string,
  excludeId: number | null = null,
): Promise<Map<string, SizeCounts>> {
  const { results } = await db
    .prepare(
      `SELECT b.occupy_from, b.occupy_to, bd.size, COUNT(*) AS n
         FROM booking_dogs bd JOIN bookings b ON b.id = bd.booking_id
        WHERE b.service = ? AND b.status IN (${HOLDING_SQL}) AND b.occupy_from <= ? AND b.occupy_to >= ? AND b.id <> ?
        GROUP BY b.id, bd.size`,
    )
    .bind(service, to, from, excludeId ?? 0)
    .all<{ occupy_from: string; occupy_to: string; size: DogSize; n: number }>();
  const out = new Map<string, SizeCounts>();
  for (const d of datesBetween(from, to)) out.set(d, zeroCounts());
  for (const r of results) {
    const a = r.occupy_from < from ? from : r.occupy_from;
    const z = r.occupy_to > to ? to : r.occupy_to;
    for (const d of datesBetween(a, z)) out.get(d)![r.size] += r.n;
  }
  return out;
}

/** 管理画面のカレンダーの1日ずつ(受け入れ数・使っている数・予約の数・確認待ちの数) */
export async function dayCounts(
  db: D1Database,
  settings: Settings,
  service: BookingService,
  from: string,
  to: string,
): Promise<BookingDayCounts[]> {
  const caps = await capacitiesFor(db, settings, service, from, to);
  const used = await usedFor(db, service, from, to);
  // その日にかかる予約(お泊まりはチェックアウトの日も含む。お断り・キャンセルは除く)
  const { results } = await db
    .prepare(
      `SELECT start_date, end_date, status FROM bookings
        WHERE service = ? AND status IN (${HOLDING_SQL}, 'no_show') AND start_date <= ? AND end_date >= ?`,
    )
    .bind(service, to, from)
    .all<{ start_date: string; end_date: string; status: BookingStatus }>();
  const counts = new Map<string, { n: number; pending: number }>();
  for (const r of results) {
    for (const d of datesBetween(r.start_date < from ? from : r.start_date, r.end_date > to ? to : r.end_date)) {
      const c = counts.get(d) ?? { n: 0, pending: 0 };
      c.n += 1;
      if (r.status === 'pending') c.pending += 1;
      counts.set(d, c);
    }
  }
  return datesBetween(from, to).map((d) => {
    const cap = caps.get(d)!;
    return {
      date: d,
      closed: cap.closed,
      closedReason: cap.closedReason,
      overridden: cap.overridden,
      caps: cap.caps,
      used: used.get(d)!,
      bookings: counts.get(d)?.n ?? 0,
      pending: counts.get(d)?.pending ?? 0,
    };
  });
}

/** 受け入れ数を超える日とサイズ(予約を入れる前の確かめ。同時の予約は booking_guard が守る) */
export function overflows(
  caps: Map<string, DayCapacity>,
  used: Map<string, SizeCounts>,
  need: SizeCounts,
): BookingFullDetails['dates'] {
  const out: BookingFullDetails['dates'] = [];
  for (const [date, cap] of caps) {
    const u = used.get(date) ?? zeroCounts();
    for (const s of DOG_SIZES) {
      if (need[s] === 0) continue;
      if (u[s] + need[s] > cap.caps[s]) out.push({ date, size: s, caps: cap.caps[s], used: u[s], need: need[s] });
    }
  }
  return out;
}

/**
 * 最後の1枠の見張り。予約を入れる batch の最後に置く。
 * その予約が使う日・サイズごとに、いま数えた数(この batch で入れた予約を含む)が受け入れ数を超えていれば ok = 0 にし、
 * CHECK (ok = 1) で batch 全体を取り消させる。
 */
export function guardStatement(
  db: D1Database,
  service: BookingService,
  caps: Map<string, DayCapacity>,
  need: SizeCounts,
): D1PreparedStatement | null {
  // 日・サイズ・受け入れ数の組を1つの JSON にして渡す(D1 の「1つの文に100個まで」の決まりに、泊数が長くても収まるように)
  const checks: { d: string; s: DogSize; c: number }[] = [];
  for (const [date, cap] of caps) {
    for (const s of DOG_SIZES) if (need[s] > 0) checks.push({ d: date, s, c: cap.caps[s] });
  }
  if (checks.length === 0) return null;
  return db
    .prepare(
      `UPDATE booking_guard SET version = version + 1, ok = CASE WHEN EXISTS (
         SELECT 1 FROM json_each(?1) j
          WHERE (SELECT COUNT(*) FROM booking_dogs bd JOIN bookings b ON b.id = bd.booking_id
                  WHERE b.service = ?2 AND b.status IN (${HOLDING_SQL}) AND bd.size = json_extract(j.value, '$.s')
                    AND b.occupy_from <= json_extract(j.value, '$.d') AND b.occupy_to >= json_extract(j.value, '$.d'))
                > json_extract(j.value, '$.c')
       ) THEN 0 ELSE 1 END WHERE id = 1`,
    )
    .bind(JSON.stringify(checks), service);
}

/**
 * 同じワンちゃんの予約が重ならないための見張り。予約(token か id で指す)の行のあとに置く。
 * その予約のワンちゃんに、ほかの重なる予約(確認待ち・確定・お預かり中・利用済み)があれば dog_ok = 0 にして batch 全体を取り消させる
 */
export function dogGuardStatement(db: D1Database, ref: { token: string } | { id: number }): D1PreparedStatement {
  const target = 'token' in ref ? 'b1.token = ?1' : 'b1.id = ?1';
  return db
    .prepare(
      `UPDATE booking_dog_guard SET version = version + 1, dog_ok = CASE WHEN EXISTS (
         SELECT 1 FROM bookings b1
           JOIN booking_dogs bd1 ON bd1.booking_id = b1.id
           JOIN booking_dogs bd2 ON bd2.dog_id = bd1.dog_id AND bd2.booking_id <> b1.id
           JOIN bookings b2 ON b2.id = bd2.booking_id
          WHERE ${target} AND b2.status IN (${HOLDING_SQL})
            AND b2.occupy_from <= b1.occupy_to AND b2.occupy_to >= b1.occupy_from
       ) THEN 0 ELSE 1 END WHERE id = 1`,
    )
    .bind('token' in ref ? ref.token : ref.id);
}

/** 受け入れ数の見張りに引っかかった(同時の予約で、受け入れ数を超えそうになった) */
export function isGuardError(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e);
  return /CHECK constraint failed:?\s*ok\b/i.test(msg);
}

/** 同じワンちゃんの見張りに引っかかった */
export function isDogGuardError(e: unknown): boolean {
  return /CHECK constraint failed:?\s*dog_ok\b/i.test(String((e as Error)?.message ?? e));
}

export const duplicateError = (name?: string) =>
  errors.conflict(
    'booking_duplicate',
    `${name ? `${name}は、` : ''}その日にもう予約があります。予約の一覧で確かめてください。変えるときは、前の予約をキャンセルしてから入れ直してください。`,
  );

export const fullError = (details: BookingFullDetails['dates'], message?: string) =>
  new AppError(
    409,
    'booking_full',
    message ?? 'ほかの予約で、その日はいっぱいになりました。カレンダーで別の日を選んでください。',
    { dates: details } satisfies BookingFullDetails,
  );

// ---------------------------------------------------------------
// ワンちゃん
// ---------------------------------------------------------------

export type BookingDogRow = {
  id: number;
  name: string;
  breed_name: string;
  size: DogSize;
  thumb_key: string | null;
  rabies_vaccine_year: number | null;
  combo_vaccine_year: number | null;
  stay_experience_at: string | null;
};

/** おうちの、登録中のワンちゃん(予約に選べる子) */
export async function householdActiveDogs(db: D1Database, householdId: number): Promise<BookingDogRow[]> {
  const { results } = await db
    .prepare(
      `SELECT d.id, d.name, COALESCE(d.breed_other, b.name) AS breed_name, d.size, d.thumb_key,
              d.rabies_vaccine_year, d.combo_vaccine_year, d.stay_experience_at
         FROM dogs d JOIN breeds b ON b.id = d.breed_id
        WHERE d.household_id = ? AND d.status = 'active' ORDER BY d.id`,
    )
    .bind(householdId)
    .all<BookingDogRow>();
  return results;
}

/** 受付でお預かりしたことがある(または「預かり経験あり」の印がある)ワンちゃん。統合でまとめた子の記録も数える */
export async function experiencedDogIds(db: D1Database, dogIds: number[]): Promise<Set<number>> {
  if (dogIds.length === 0) return new Set();
  const { results } = await db
    .prepare(
      `SELECT d.id FROM dogs d
        WHERE d.id IN (SELECT value FROM json_each(?))
          AND (d.stay_experience_at IS NOT NULL
               OR EXISTS (SELECT 1 FROM booking_dogs bd JOIN bookings b ON b.id = bd.booking_id
                           WHERE b.status IN (${STAYED_SQL})
                             AND bd.dog_id IN (SELECT x.id FROM dogs x WHERE x.id = d.id OR (x.merged_into_id = d.id AND x.status = 'merged'))))`,
    )
    .bind(JSON.stringify(dogIds))
    .all<{ id: number }>();
  return new Set(results.map((r) => r.id));
}

/** 選んだワンちゃんが、そのおうちの登録中の子かを確かめる */
export async function pickDogs(db: D1Database, householdId: number, dogIds: number[]): Promise<BookingDogRow[]> {
  const all = await householdActiveDogs(db, householdId);
  const byId = new Map(all.map((d) => [d.id, d]));
  const picked = dogIds.map((id) => byId.get(id));
  if (picked.some((d) => !d)) {
    throw errors.badRequest('選んだワンちゃんが見つかりませんでした。画面を読み込み直して、選び直してください。');
  }
  return picked as BookingDogRow[];
}

// ---------------------------------------------------------------
// 予約を入れる
// ---------------------------------------------------------------

export type CreateBookingArgs = {
  householdId: number;
  service: BookingService;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  dogIds: number[];
  note: string | null;
  checklist: string[];
  source: 'customer' | 'staff';
  memberId: number | null;
  staffId: number | null;
  staffNote?: string | null;
  /** いっぱいの日でも入れる理由(管理者の手入力だけ) */
  overrideReason?: string | null;
  /** お客さんの送信の印(LINE ユーザーのハッシュ:送信の印)。同じ印の予約は1つだけ */
  requestKey?: string | null;
  now: Date;
};

export type CreateBookingOptions = {
  /** テスト用: 先の確かめを飛ばして、見張り(booking_guard)だけで守れるかを確かめる */
  skipPrecheck?: boolean;
};

/**
 * 予約を入れる。
 * - お客さん: 予約できる期間・受付の時間・同じ子の重なり・受け入れ数を確かめる。はじめての子がいれば確認待ち
 * - 受付の手入力: 期間の決まりは外す。いっぱいなら 409(管理者は理由を書けば入れられる)。いつも確定
 */
export async function createBooking(
  db: D1Database,
  settings: Settings,
  args: CreateBookingArgs,
  opts: CreateBookingOptions = {},
): Promise<number> {
  const today = toJstDate(args.now);
  const dateProblem = checkBookingDates(settings, args, today, { ignoreWindow: args.source === 'staff' });
  if (dateProblem) throw errors.badRequest(dateProblem);
  const dogs = await pickDogs(db, args.householdId, args.dogIds);
  const range = occupiedRange(args.service, args.startDate, args.endDate);
  const need = countBySize(dogs.map((d) => d.size));
  const caps = await capacitiesFor(db, settings, args.service, range.from, range.to);

  if (args.source === 'customer') {
    const closed = [...caps.values()].some((c) => c.closed);
    if (closed) throw errors.conflict('booking_closed', '選んだ日にお休みの日が入っています。カレンダーで別の日を選んでください。');
    // お泊まりはチェックアウトの日もお店が開いている日にする
    if (args.service === 'boarding') {
      const out = await capacitiesFor(db, settings, 'boarding', args.endDate, args.endDate);
      if (out.get(args.endDate)!.closed) {
        throw errors.conflict('booking_closed', 'チェックアウトの日がお休みです。別の日を選んでください。');
      }
    }
  }

  // 同じ子の予約が重なっていないか(お断り・キャンセル・来なかったは除く)
  // (同時の予約は、batch の中の見張り dogGuardStatement が守る。ここは分かりやすい知らせのための先の確かめ)
  const dup = await db
    .prepare(
      `SELECT d.name FROM booking_dogs bd JOIN bookings b ON b.id = bd.booking_id JOIN dogs d ON d.id = bd.dog_id
        WHERE bd.dog_id IN (SELECT value FROM json_each(?)) AND b.status IN (${HOLDING_SQL}) AND b.occupy_from <= ? AND b.occupy_to >= ? LIMIT 1`,
    )
    .bind(JSON.stringify(dogs.map((d) => d.id)), range.to, range.from)
    .first<{ name: string }>();
  if (dup && !opts.skipPrecheck) throw duplicateError(dup.name);

  const override = args.source === 'staff' && args.overrideReason ? args.overrideReason : null;
  if (!opts.skipPrecheck && !override) {
    const used = await usedFor(db, args.service, range.from, range.to);
    const over = overflows(caps, used, need);
    if (over.length > 0) {
      throw fullError(
        over,
        args.source === 'staff'
          ? 'その日は受け入れる頭数を超えます。別の日にするか、管理者が理由を書いて入れてください。'
          : 'その日は、選んだワンちゃんのサイズの空きがありません。カレンダーで別の日を選んでください。',
      );
    }
  }

  const experienced = await experiencedDogIds(db, dogs.map((d) => d.id));
  const reason: ApprovalReason =
    args.source === 'staff' ? null : approvalReason(settings.booking_approve_all, dogs.map((d) => ({ experienced: experienced.has(d.id) })));
  const status: BookingStatus = reason ? 'pending' : 'confirmed';
  const estimate = estimateBooking(settings, { ...args, dogs: dogs.map((d) => ({ id: d.id, name: d.name, size: d.size })) });
  const token = crypto.randomUUID();
  const nowIso = toJstIso(args.now);
  const checklist = args.checklist.filter((x) => settings.booking_checklist.includes(x));

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO bookings (household_id, service, status, start_date, end_date, start_time, end_time, occupy_from, occupy_to,
                               note, checklist, estimate_total, estimate_detail, source, approval_reason, requested_by_member_id,
                               created_by_staff_id, token, staff_note, capacity_override_reason, decided_at, created_at, updated_at, request_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        args.householdId,
        args.service,
        status,
        args.startDate,
        args.endDate,
        args.startTime,
        args.endTime,
        range.from,
        range.to,
        args.note,
        JSON.stringify(checklist),
        estimate.total,
        JSON.stringify(estimate),
        args.source,
        reason,
        args.memberId,
        args.staffId,
        token,
        args.staffNote ?? null,
        override,
        status === 'confirmed' ? nowIso : null,
        nowIso,
        nowIso,
        args.requestKey ?? null,
      ),
    ...dogs.map((d) =>
      db
        .prepare(
          `INSERT INTO booking_dogs (booking_id, dog_id, size, first_time)
           SELECT id, ?, ?, ? FROM bookings WHERE token = ?`,
        )
        .bind(d.id, d.size, experienced.has(d.id) ? 0 : 1, token),
    ),
  ];
  statements.push(dogGuardStatement(db, { token }));
  if (!override) {
    const guard = guardStatement(db, args.service, caps, need);
    if (guard) statements.push(guard);
  }
  statements.push(
    auditStatement(db, {
      staffId: args.staffId,
      actor: args.source === 'customer' ? { type: 'member', id: args.memberId } : undefined,
      action: args.source === 'customer' ? 'booking.request' : 'booking.create',
      targetType: 'booking',
      targetId: { sql: 'SELECT id FROM bookings WHERE token = ?', args: [token] },
      after: {
        service: args.service,
        status,
        startDate: args.startDate,
        endDate: args.endDate,
        dogs: dogs.map((d) => d.name),
        overrideReason: override,
      },
      reason: override,
      now: args.now,
    }),
  );

  try {
    await db.batch(statements);
  } catch (e) {
    if (isDogGuardError(e)) throw duplicateError();
    if (isGuardError(e)) {
      // 同時に入った予約で、いっぱいになった
      const used = await usedFor(db, args.service, range.from, range.to);
      throw fullError(overflows(caps, used, need));
    }
    throw e;
  }
  const row = await db.prepare('SELECT id FROM bookings WHERE token = ?').bind(token).first<{ id: number }>();
  return row!.id;
}

// ---------------------------------------------------------------
// 状態を変える
// ---------------------------------------------------------------

export type Transition = 'approve' | 'decline' | 'check_in' | 'complete' | 'no_show' | 'cancel';

const TRANSITIONS: Record<Transition, { from: BookingStatus[]; to: BookingStatus; action: string }> = {
  approve: { from: ['pending'], to: 'confirmed', action: 'booking.approve' },
  decline: { from: ['pending'], to: 'declined', action: 'booking.decline' },
  check_in: { from: ['confirmed'], to: 'checked_in', action: 'booking.check_in' },
  complete: { from: ['checked_in'], to: 'completed', action: 'booking.complete' },
  no_show: { from: ['confirmed'], to: 'no_show', action: 'booking.no_show' },
  cancel: { from: ['pending', 'confirmed'], to: 'cancelled', action: 'booking.cancel' },
};

export function allowedActions(status: BookingStatus): Transition[] {
  return (Object.keys(TRANSITIONS) as Transition[]).filter((t) => TRANSITIONS[t].from.includes(status));
}

const NOT_ALLOWED: Record<Transition, string> = {
  approve: 'この予約は、もう確認待ちではありません。画面を読み込み直してください。',
  decline: 'この予約は、もう確認待ちではありません。画面を読み込み直してください。',
  check_in: '利用開始にできるのは、確定した予約だけです。画面を読み込み直してください。',
  complete: '利用済みにできるのは、お預かり中の予約だけです。画面を読み込み直してください。',
  no_show: '「来なかった」にできるのは、確定した予約だけです。画面を読み込み直してください。',
  cancel: 'この予約は、もうキャンセルできない状態です。画面を読み込み直してください。',
};

/** 状態の変更に合わせて書く列 */
function columnsFor(t: Transition, actor: { type: 'staff' | 'member'; id: number }, nowIso: string, message: string | null, reason: string | null) {
  switch (t) {
    case 'approve':
    case 'decline':
      return { sql: 'decided_at = ?, decided_by_staff_id = ?, decision_message = ?', args: [nowIso, actor.id, message] };
    case 'check_in':
      return { sql: 'checked_in_at = ?, checked_in_by_staff_id = ?', args: [nowIso, actor.id] };
    case 'complete':
      return { sql: 'completed_at = ?, completed_by_staff_id = ?', args: [nowIso, actor.id] };
    case 'no_show':
      return { sql: 'no_show_at = ?, no_show_by_staff_id = ?', args: [nowIso, actor.id] };
    case 'cancel':
      return { sql: 'cancelled_at = ?, cancelled_by_type = ?, cancelled_by_id = ?, cancel_reason = ?', args: [nowIso, actor.type, actor.id, reason] };
  }
}

/**
 * 予約の状態を変える(条件つきの UPDATE。同時に2回押されても1回だけ)。操作ログに残す(元に戻せる)。
 */
export async function transitionBooking(
  db: D1Database,
  booking: BookingRow,
  t: Transition,
  actor: { type: 'staff' | 'member'; id: number },
  now: Date,
  opts: { message?: string | null; reason?: string | null } = {},
): Promise<void> {
  const rule = TRANSITIONS[t];
  if (!rule.from.includes(booking.status)) throw errors.conflict('booking_state', NOT_ALLOWED[t]);
  const nowIso = toJstIso(now);
  const cols = columnsFor(t, actor, nowIso, opts.message ?? null, opts.reason ?? null);
  const res = await db.batch([
    db
      .prepare(`UPDATE bookings SET status = ?, ${cols.sql}, updated_at = ? WHERE id = ? AND status = ?`)
      .bind(rule.to, ...cols.args, nowIso, booking.id, booking.status),
    auditStatement(db, {
      staffId: actor.type === 'staff' ? actor.id : null,
      actor: actor.type === 'member' ? { type: 'member', id: actor.id } : undefined,
      action: rule.action,
      targetType: 'booking',
      targetId: booking.id,
      before: { status: booking.status },
      after: { status: rule.to, message: opts.message ?? null },
      reason: opts.reason ?? null,
      now,
      onlyIf: { sql: 'changes() = 1', args: [] },
    }),
  ]);
  if (res[0]!.meta.changes !== 1) throw errors.conflict('booking_state', NOT_ALLOWED[t]);
}

/**
 * 元に戻す(操作ログ A-15)。いまの状態が after と同じときだけ、before の状態に戻す。
 * 枠を空けた状態(お断り・キャンセル・来なかった)から枠を使う状態に戻すときは、受け入れ数を確かめる。
 */
export async function revertBookingStatus(
  db: D1Database,
  settings: Settings,
  bookingId: number,
  after: BookingStatus,
  before: BookingStatus,
  now: Date,
): Promise<void> {
  const b = await findBooking(db, bookingId);
  if (b.status !== after) {
    throw errors.conflict('booking_changed', 'この予約は、そのあとに状態が変わっています。予約の画面で直してください。');
  }
  const nowIso = toJstIso(now);
  // 戻す状態に合わせて、記録の列を空にする
  const clear: Record<BookingStatus, string> = {
    pending: 'decided_at = NULL, decided_by_staff_id = NULL, decision_message = NULL',
    confirmed: '',
    declined: '',
    cancelled: '',
    checked_in: 'completed_at = NULL, completed_by_staff_id = NULL',
    completed: '',
    no_show: '',
  };
  const parts: string[] = [];
  if (before === 'pending') parts.push(clear.pending);
  if (after === 'checked_in') parts.push('checked_in_at = NULL, checked_in_by_staff_id = NULL');
  if (after === 'completed') parts.push(clear.checked_in);
  if (after === 'no_show') parts.push('no_show_at = NULL, no_show_by_staff_id = NULL');
  if (after === 'cancelled') parts.push('cancelled_at = NULL, cancelled_by_type = NULL, cancelled_by_id = NULL, cancel_reason = NULL');
  if (after === 'declined') parts.push('decided_at = NULL, decided_by_staff_id = NULL, decision_message = NULL');
  const set = parts.filter(Boolean).join(', ');
  const statements: D1PreparedStatement[] = [
    db
      .prepare(`UPDATE bookings SET status = ?${set ? `, ${set}` : ''}, updated_at = ? WHERE id = ? AND status = ?`)
      .bind(before, nowIso, b.id, after),
  ];
  const reHolds = !BOOKING_HOLDING_STATUSES.includes(after) && BOOKING_HOLDING_STATUSES.includes(before);
  let caps: Map<string, DayCapacity> | null = null;
  if (reHolds) {
    caps = await capacitiesFor(db, settings, b.service, b.occupy_from, b.occupy_to);
    const need = await bookingNeed(db, b.id);
    const guard = guardStatement(db, b.service, caps, need);
    if (guard) statements.push(guard);
    statements.push(dogGuardStatement(db, { id: b.id }));
  }
  try {
    await db.batch(statements);
  } catch (e) {
    if (isDogGuardError(e)) {
      throw errors.conflict('booking_duplicate', 'このワンちゃんには、そのあとに重なる日の予約が入っているため戻せません。予約の画面で確かめてください。');
    }
    if (isGuardError(e)) {
      throw errors.conflict('booking_full', 'その日は、ほかの予約でいっぱいになっているため戻せません。受け入れる頭数を増やしてから戻してください。');
    }
    throw e;
  }
}

/** 予約のワンちゃんのサイズごとの頭数 */
export async function bookingNeed(db: D1Database, bookingId: number): Promise<SizeCounts> {
  const { results } = await db.prepare('SELECT size FROM booking_dogs WHERE booking_id = ?').bind(bookingId).all<{ size: DogSize }>();
  return countBySize(results.map((r) => r.size));
}

// ---------------------------------------------------------------
// 表示
// ---------------------------------------------------------------

/** 予約のワンちゃん(まとめて読む) */
export async function bookingDogs(db: D1Database, ids: number[], mediaBase: string): Promise<Map<number, BookingDogView[]>> {
  const out = new Map<number, BookingDogView[]>();
  if (ids.length === 0) return out;
  const { results } = await db
    .prepare(
      `SELECT bd.booking_id, d.id, d.name, COALESCE(d.breed_other, br.name) AS breed_name, bd.size, d.thumb_key, bd.first_time
         FROM booking_dogs bd JOIN dogs d ON d.id = bd.dog_id JOIN breeds br ON br.id = d.breed_id
        WHERE bd.booking_id IN (SELECT value FROM json_each(?)) ORDER BY bd.id`,
    )
    .bind(JSON.stringify(ids))
    .all<{ booking_id: number; id: number; name: string; breed_name: string; size: DogSize; thumb_key: string | null; first_time: number }>();
  for (const r of results) {
    const list = out.get(r.booking_id) ?? [];
    list.push({
      id: r.id,
      name: r.name,
      breedName: r.breed_name,
      size: r.size,
      thumbUrl: r.thumb_key ? `${mediaBase}/${r.thumb_key}` : null,
      firstTime: r.first_time === 1,
    });
    out.set(r.booking_id, list);
  }
  return out;
}

export function toSummary(r: BookingRow, dogs: BookingDogView[]): BookingSummary {
  return {
    id: r.id,
    service: r.service,
    status: r.status,
    startDate: r.start_date,
    endDate: r.end_date,
    startTime: r.start_time,
    endTime: r.end_time,
    dogs,
    estimateTotal: r.estimate_total,
    createdAt: r.created_at,
  };
}

const parseJson = <T>(s: string | null, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

export function toCustomerDetail(r: BookingRow, dogs: BookingDogView[], settings: Settings, now: Date): BookingDetail {
  return {
    ...toSummary(r, dogs),
    note: r.note,
    checklist: parseJson<string[]>(r.checklist, []),
    estimate: parseJson<BookingEstimate>(r.estimate_detail, { total: r.estimate_total, lines: [], halfDay: false, nights: 0 }),
    approvalReason: r.approval_reason,
    decisionMessage: r.decision_message,
    cancelDeadline: cancelDeadline(settings, r.start_date),
    canCancel: canCustomerCancel(settings, { status: r.status, startDate: r.start_date }, now),
    requestedBy: r.requested_by,
    cancelledAt: r.cancelled_at,
  };
}

export function toAdminRow(r: BookingRow, dogs: BookingDogView[]): AdminBookingRow {
  return {
    ...toSummary(r, dogs),
    householdId: r.household_id,
    memberNo: r.member_no,
    householdName: r.household_name,
    note: r.note,
    staffNote: r.staff_note,
    source: r.source,
    approvalReason: r.approval_reason,
    requestedBy: r.requested_by,
    ownerNames: r.owner_names ? r.owner_names.split('、') : [],
  };
}

export async function adminDetail(db: D1Database, id: number, mediaBase: string): Promise<AdminBookingDetail> {
  const r = await findBooking(db, id);
  const dogs = (await bookingDogs(db, [r.id], mediaBase)).get(r.id) ?? [];
  const { results: notes } = await db
    .prepare('SELECT id, kind, status, reason, message, created_at FROM booking_notifications WHERE booking_id = ? ORDER BY id')
    .bind(r.id)
    .all<{ id: number; kind: 'confirmed' | 'declined'; status: BookingNotificationView['status']; reason: string | null; message: string; created_at: string }>();
  const canceller =
    r.cancelled_by_type === 'staff'
      ? await db.prepare('SELECT name FROM staff_users WHERE id = ?').bind(r.cancelled_by_id).first<{ name: string }>()
      : r.cancelled_by_type === 'member'
        ? await db.prepare('SELECT line_display_name AS name FROM family_members WHERE id = ?').bind(r.cancelled_by_id).first<{ name: string }>()
        : null;
  return {
    ...toAdminRow(r, dogs),
    checklist: parseJson<string[]>(r.checklist, []),
    estimate: parseJson<BookingEstimate>(r.estimate_detail, { total: r.estimate_total, lines: [], halfDay: false, nights: 0 }),
    decisionMessage: r.decision_message,
    decidedAt: r.decided_at,
    decidedBy: r.decided_by,
    cancelReason: r.cancel_reason,
    cancelledAt: r.cancelled_at,
    cancelledBy: canceller ? `${canceller.name ?? ''}${r.cancelled_by_type === 'member' ? '(お客さん)' : ''}` : null,
    capacityOverrideReason: r.capacity_override_reason,
    checkedInAt: r.checked_in_at,
    completedAt: r.completed_at,
    notifications: notes.map((n) => ({
      id: n.id,
      kind: n.kind,
      status: n.status,
      reason: n.reason,
      reasonText: n.reason ? (BOOKING_NOTIFY_REASON_LABELS[n.reason] ?? n.reason) : null,
      message: n.message,
      createdAt: n.created_at,
    })),
    actions: allowedActions(r.status),
  };
}

/** 管理画面の一覧(条件は SQL の WHERE。b. を付けて書く) */
export async function adminList(db: D1Database, where: string, args: unknown[], mediaBase: string, order = 'b.start_date, b.start_time, b.id'): Promise<AdminBookingRow[]> {
  const { results } = await db.prepare(`${BOOKING_SELECT} WHERE ${where} ORDER BY ${order} LIMIT 500`).bind(...args).all<BookingRow>();
  const dogs = await bookingDogs(db, results.map((r) => r.id), mediaBase);
  return results.map((r) => toAdminRow(r, dogs.get(r.id) ?? []));
}

/** お客さんの予約の一覧(統合でまとめたおうちの分も) */
export async function customerList(db: D1Database, householdId: number, mediaBase: string): Promise<{ rows: BookingRow[]; dogs: Map<number, BookingDogView[]> }> {
  const { results } = await db
    .prepare(
      `WITH RECURSIVE ${MERGED_HOUSEHOLDS_CTE}
       ${BOOKING_SELECT} WHERE b.household_id IN (SELECT id FROM hh)
       ORDER BY b.start_date DESC, b.id DESC LIMIT 200`,
    )
    .bind(householdId)
    .all<BookingRow>();
  return { rows: results, dogs: await bookingDogs(db, results.map((r) => r.id), mediaBase) };
}

/** 確認待ちの数(サイドバーの印) */
export async function pendingCount(db: D1Database): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status = 'pending'").first<{ n: number }>();
  return r?.n ?? 0;
}

/** 予約を見られるおうちか(統合でまとめたおうちを含む) */
export async function bookingBelongsTo(db: D1Database, booking: BookingRow, householdId: number): Promise<boolean> {
  if (booking.household_id === householdId) return true;
  const r = await db
    .prepare(`WITH RECURSIVE ${MERGED_HOUSEHOLDS_CTE} SELECT 1 AS ok FROM hh WHERE id = ?`)
    .bind(householdId, booking.household_id)
    .first<{ ok: number }>();
  return !!r;
}

export { addDays };
