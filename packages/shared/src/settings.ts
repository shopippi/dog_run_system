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
  /** 「困ったとき」に出す製作者の連絡先 */
  developer_contact: z.string().max(500),
  /** 利用規約とプライバシーポリシーの本文 */
  terms_text: z.string().max(20000),
  privacy_text: z.string().max(20000),
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
  developer_contact: '',
  terms_text: '(利用規約の本文は準備中です。管理画面の設定から差し替えてください)',
  privacy_text: '(プライバシーポリシーの本文は準備中です。管理画面の設定から差し替えてください)',
};
