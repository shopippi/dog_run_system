import { z } from 'zod';
import { DOG_SEXES, DOG_SIZES } from '../constants';
import { birthYmSchema, dogNameSchema } from './dog';

// 入力チェック(households: おうちの詳細と記録、操作ログ)

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: '日付を選び直してください。' });

/** 操作ログの絞り込み(A-15)。空の値は「絞り込まない」 */
export const auditQuerySchema = z.object({
  from: ymd.optional(),
  to: ymd.optional(),
  action: z.string().max(60).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

/** 操作ログの1ページの行数 */
export const AUDIT_PAGE_SIZE = 50;

/** おうちの呼び名の変更(A-02)。空にすると、犬の名前から自動で作る呼び名に戻す */
export const householdRenameSchema = z.object({
  displayName: z
    .string({ error: '呼び名を入力してください。' })
    .trim()
    .max(40, { error: '呼び名は40文字までで入力してください。' }),
});
export type HouseholdRename = z.infer<typeof householdRenameSchema>;

/** ポイント・無料券の手動登録の理由(A-03) */
export const MANUAL_POINT_REASONS = ['イベントの特典', 'お詫び', '入力ミスの修正', 'その他'] as const;
export type ManualPointReason = (typeof MANUAL_POINT_REASONS)[number];

/** ポイント・無料券の手動登録(A-03)。理由は選択式で、「その他」のときは内容の入力が必要 */
export const manualPointsSchema = z
  .object({
    points: z
      .number({ error: 'ポイントは数字で入れてください。' })
      .int({ error: 'ポイントは数字で入れてください。' })
      .min(-100, { error: '一度に減らせるのは100ポイントまでです。' })
      .max(100, { error: '一度に増やせるのは100ポイントまでです。' }),
    tickets: z
      .number({ error: '無料券の枚数は数字で入れてください。' })
      .int({ error: '無料券の枚数は数字で入れてください。' })
      .min(-20, { error: '一度に減らせる無料券は20枚までです。' })
      .max(20, { error: '一度に増やせる無料券は20枚までです。' }),
    reason: z.enum(MANUAL_POINT_REASONS, { error: '理由を選んでください。' }),
    note: z.string().trim().max(100, { error: '理由の内容は100文字までで入力してください。' }).default(''),
  })
  .refine((v) => v.points !== 0 || v.tickets !== 0, { error: '増やす・減らすポイントか、無料券の枚数を入れてください。' })
  .refine((v) => v.reason !== 'その他' || v.note.length > 0, {
    error: '「その他」を選んだときは、理由の内容を入力してください。',
    path: ['note'],
  });
export type ManualPointsInput = z.infer<typeof manualPointsSchema>;

/** 台帳と操作ログに残す理由の文 */
export function manualReasonText(input: { reason: ManualPointReason; note: string }): string {
  if (!input.note) return input.reason;
  return input.reason === 'その他' ? `その他: ${input.note}` : `${input.reason}(${input.note})`;
}

/**
 * 管理者による犬の情報の変更(A-04)。犬種とサイズを変えるときは理由が必要(6.1)。
 * status は登録のおやすみ(retired)と、登録に戻す(active)。
 */
export const adminDogPatchSchema = z
  .object({
    name: dogNameSchema,
    breedId: z.number({ error: '犬種を選んでください。' }).int().positive({ error: '犬種を選んでください。' }),
    breedOther: z.string().trim().max(30, { error: '犬種は30文字までで入力してください。' }).nullable(),
    size: z.enum(DOG_SIZES, { error: 'サイズ(小型・中型・大型)を選んでください。' }),
    sex: z.enum(DOG_SEXES).nullable(),
    birthYm: birthYmSchema.nullable(),
    status: z.enum(['active', 'retired']),
    reason: z.string().trim().max(100, { error: '理由は100文字までで入力してください。' }),
  })
  .partial();
export type AdminDogPatch = z.infer<typeof adminDogPatchSchema>;

/** 写真の変更の種類(A-04)。回転は画面側で回した JPEG を送る */
export const DOG_PHOTO_KINDS = ['replace', 'rotate'] as const;
export type DogPhotoKind = (typeof DOG_PHOTO_KINDS)[number];
