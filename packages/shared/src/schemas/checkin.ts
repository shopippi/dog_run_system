import { z } from 'zod';

const dogIdsSchema = z
  .array(z.number().int().positive())
  .min(1, { error: '今日来たワンちゃんを1頭以上選んでください。' })
  .max(30);

/** チェックイン(POST /api/checkins)の入力(C-04)。無料券はチェックインでは使わない(会員証で右へスライドして使う) */
export const checkinSchema = z.object({
  /** 受付の固定QRコードの合言葉 */
  passphrase: z.string().max(100),
  dogIds: dogIdsSchema,
  /**
   * 「確定」を押した時刻(スマホの時計のミリ秒)。電波が弱く送信が遅れたときに使う。
   * 送った時刻は x-client-now ヘッダーで別に送り、その差だけを使う(resolveCheckinTime)
   */
  pressedAt: z.number().int().positive().max(8.64e15).optional(),
});
export type CheckinInput = z.infer<typeof checkinSchema>;

/** 同じ日に家族が来たときの、犬の追加(POST /api/checkins/:id/dogs) */
export const addVisitDogsSchema = z.object({ dogIds: dogIdsSchema });
