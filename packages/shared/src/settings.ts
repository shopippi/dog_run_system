import { z } from 'zod';

// 管理画面から変えられる設定(settings テーブル。キーと JSON の値)。
// 未決事項(要件定義書 20章)に関わる値は、ここに初期案を置く。

export const expiryRuleSchema = z.discriminatedUnion('mode', [
  // 期限なし
  z.object({ mode: z.literal('none') }),
  // もらった日から○か月
  z.object({ mode: z.literal('months_from_grant'), months: z.number().int().min(1).max(120) }),
  // 最後に来場した日から○か月
  z.object({ mode: z.literal('months_from_last_visit'), months: z.number().int().min(1).max(120) }),
]);
export type ExpiryRule = z.infer<typeof expiryRuleSchema>;

/** LINEミニアプリの番号の入れ方(エラーの文) */
export const LIFF_ID_MESSAGE =
  '「1234567890-AbCdEfGh」のような形(数字・ハイフン・英数字)で入れてください。製作者から伝えられた番号をそのまま貼り付けてください。';

/** 予約の時刻("09:00" の形。00:00〜23:59) */
const hhmmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
/** サイズごとの頭数(予約の受け入れ数) */
const bookingSizeCountsSchema = z.object({
  small: z.number().int().min(0).max(100),
  medium: z.number().int().min(0).max(100),
  large: z.number().int().min(0).max(100),
});
/** サイズごとの料金(円) */
const bookingSizeYenSchema = z.object({
  small: z.number().int().min(0).max(1000000),
  medium: z.number().int().min(0).max(1000000),
  large: z.number().int().min(0).max(1000000),
});

export const settingsSchema = z.object({
  /** 無料券1枚に必要なポイント数 */
  points_per_ticket: z.number().int().min(1).max(100),
  /** 1日にもらえるポイントの上限(おうちごと) */
  daily_point_limit: z.number().int().min(1).max(10),
  /** 無料券を使った日にもポイントを付けるか */
  grant_point_on_ticket_day: z.boolean(),
  point_expiry: expiryRuleSchema,
  ticket_expiry: expiryRuleSchema,
  /** リピート率の判定日数 */
  repeat_days: z.number().int().min(1).max(365),
  /** 休眠の判定日数 */
  dormant_days: z.number().int().min(1).max(730),
  /** 休眠している常連の判定に使う来場回数 */
  dormant_min_visits: z.number().int().min(1).max(100),
  /** 受付の固定QRコードに入れる合言葉 */
  checkin_passphrase: z.string().min(8).max(64),
  /** お客さん同士の招待の有効時間 */
  invite_ttl_hours: z.number().int().min(1).max(168),
  /** 受付で出す招待QRの有効時間 */
  reception_invite_ttl_minutes: z.number().int().min(1).max(120),
  /** 旧カードからの移行期間 */
  migration_period: z.object({
    start: z.string().nullable(),
    end: z.string().nullable(),
  }),
  /** 旧カードから一度に引き継げるポイントの上限(16.1。不正を防ぐため。未決事項) */
  migration_max_points: z.number().int().min(1).max(200),
  /**
   * 旧カードの使っていない特典(LINEのショップカードの特典チケットなど)から、一度に出せる無料券の枚数の上限(16.1、20章の未決事項。初期案は1枚)。
   * 0 にすると、特典は無料券にしない
   */
  migration_max_tickets: z.number().int().min(0).max(10),
  /**
   * 移行期間が終わったあとも、理由を書けば引き継ぎを受け付けるか(16.2、20章の未決事項。初期案は受け付けない)。
   * 始まる前は、いつも受け付けない
   */
  migration_late_entry: z.boolean(),
  /**
   * おうちの統合で、統合前に同じ日に両方のおうちが来場していた分のポイントを、そのまま残すか(5.3、20章の未決事項。初期案は残す)。
   * false にすると、その日のまとめる側の来場で付いたポイントを、統合のときに差し引く
   */
  merge_keep_same_day_points: z.boolean(),
  /** 「困ったとき」に出す製作者の連絡先 */
  developer_contact: z.string().max(500),
  /** 利用規約とプライバシーポリシーの本文 */
  terms_text: z.string().max(20000),
  privacy_text: z.string().max(20000),
  /** 天気を取る観測地点(気象庁のアメダスの地点番号5桁と名前)。所在地(兵庫県小野市樫山町)に近い三木(2026-10-31) */
  weather_station: z.object({
    code: z.string().regex(/^\d{5}$/),
    name: z.string().min(1).max(40),
  }),
  /** 施設の名前(画面の「○○ 会員証」「○○ 受付・管理」に出す。docs/changes-2026-10-28.md 1章) */
  facility_name: z.string().trim().min(1).max(30),
  /** LINE ミニアプリ(LIFF)の ID。受付で出す招待QRの URL に使う(未設定なら、同じドメインの /liff/ の URL) */
  liff_id: z.string().regex(/^$|^\d+-[A-Za-z0-9]+$/, { error: LIFF_ID_MESSAGE }),

  // ---- 預かり・お泊まりの予約(要件定義書 21章。2026-10-31) ----
  /** お客さんが LINE から予約できるか(止めると、予約の画面は「いまは受け付けていません」になる。管理画面の手入力はできる) */
  booking_enabled: z.boolean(),
  /**
   * 1つのおうちが LINE から1日にできる予約とキャンセルの回数の合計(予約とキャンセルをくり返して、LINE のお知らせの月の上限を使い切らないように。初期値 10)
   */
  booking_daily_limit: z.number().int().min(1).max(100),
  /** すべての予約を確認待ちにする(初期値は off。off のときは、はじめてのワンちゃんがいる予約だけ確認待ち) */
  booking_approve_all: z.boolean(),
  /** 受け入れる頭数(サービスごと・サイズごと)。預かりは1日あたり、お泊まりは1泊あたり(20章の未決事項) */
  booking_capacity: z.object({ daycare: bookingSizeCountsSchema, boarding: bookingSizeCountsSchema }),
  /** 料金の目安(円)。預かりは1日、お泊まりは1泊。半日は「預ける時間がこの時間以内なら半日の料金」(初期値は使わない) */
  booking_prices: z.object({
    daycare: bookingSizeYenSchema,
    boarding: bookingSizeYenSchema,
    half_day: z.object({ enabled: z.boolean(), max_hours: z.number().int().min(1).max(12), price: bookingSizeYenSchema }),
  }),
  /** 預ける・迎えに来る時刻を選べる時間(受付の時間) */
  booking_hours: z
    .object({ open: hhmmSchema, close: hhmmSchema })
    .refine((v) => v.open < v.close, { error: '受付を始める時刻は、終わる時刻より前にしてください。' }),
  /** 予約を受けない曜日(定休日。0 = 日曜 … 6 = 土曜)。その日の受け入れ数を変えると、その日だけ受けられる */
  booking_closed_weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  /** お客さんがキャンセルできる期限: 利用の初日の days_before 日前の time まで */
  booking_cancel_deadline: z.object({ days_before: z.number().int().min(0).max(14), time: hhmmSchema }),
  /** 予約できる期間: 今日から min_days_ahead 日後 〜 max_days_ahead 日後まで。お泊まりは最長 max_nights 泊 */
  booking_window: z
    .object({
      min_days_ahead: z.number().int().min(0).max(30),
      max_days_ahead: z.number().int().min(1).max(365),
      max_nights: z.number().int().min(1).max(30),
    })
    .refine((v) => v.min_days_ahead <= v.max_days_ahead, { error: '予約できる最初の日は、最後の日より前にしてください。' }),
  /** 予約のときに確かめてもらう項目(お店が自由に書ける。例「狂犬病・混合ワクチンの接種」) */
  booking_checklist: z.array(z.string().trim().min(1).max(80)).max(10),
  /** 確かめてもらう項目に、すべて印を付けないと予約できないか */
  booking_checklist_required: z.boolean(),
  /** LINE でのお知らせ(確定・お断り)。monthly_limit はひと月に送る数の上限(無料のプランは 200 通) */
  booking_notify: z.object({
    confirmed: z.boolean(),
    declined: z.boolean(),
    monthly_limit: z.number().int().min(0).max(100000),
  }),
});
export type Settings = z.infer<typeof settingsSchema>;
export type SettingKey = keyof Settings;

export const DEFAULT_SETTINGS: Omit<Settings, 'checkin_passphrase'> = {
  points_per_ticket: 10,
  daily_point_limit: 1,
  grant_point_on_ticket_day: true,
  point_expiry: { mode: 'none' },
  ticket_expiry: { mode: 'none' },
  repeat_days: 60,
  dormant_days: 90,
  dormant_min_visits: 3,
  invite_ttl_hours: 24,
  reception_invite_ttl_minutes: 10,
  migration_period: { start: null, end: null },
  migration_max_points: 30,
  migration_max_tickets: 1,
  migration_late_entry: false,
  merge_keep_same_day_points: true,
  developer_contact: '',
  terms_text: '(利用規約の本文は準備中です。管理画面の設定から差し替えてください)',
  privacy_text: '(プライバシーポリシーの本文は準備中です。管理画面の設定から差し替えてください)',
  weather_station: { code: '63461', name: '三木' },
  liff_id: '',
  facility_name: 'グリーンドーム',
  // 予約(21章。2026-10-31 の決定。中型は仮 = 小型と大型の間。20章)
  booking_enabled: true,
  booking_daily_limit: 10,
  booking_approve_all: false,
  booking_capacity: {
    daycare: { small: 5, medium: 3, large: 2 },
    boarding: { small: 5, medium: 3, large: 2 },
  },
  booking_prices: {
    daycare: { small: 3000, medium: 4000, large: 5000 },
    boarding: { small: 10000, medium: 12500, large: 15000 },
    half_day: { enabled: false, max_hours: 4, price: { small: 1500, medium: 2000, large: 2500 } },
  },
  booking_hours: { open: '09:00', close: '18:00' },
  booking_closed_weekdays: [],
  booking_cancel_deadline: { days_before: 1, time: '18:00' },
  booking_window: { min_days_ahead: 1, max_days_ahead: 60, max_nights: 14 },
  booking_checklist: ['狂犬病の予防注射と混合ワクチンを、1年以内に受けています', 'ノミ・ダニの予防をしています'],
  booking_checklist_required: true,
  booking_notify: { confirmed: true, declined: true, monthly_limit: 200 },
};

/** ログインの前でも読める、施設の名前だけ(GET /api/public-settings・GET /admin/api/public-settings) */
export type FacilityResponse = { facilityName: string };
