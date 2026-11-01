import { z } from 'zod';
import { MIGRATION_SOURCES } from '../constants';
import { MIGRATION_CARD_POINTS_LIMIT, MIGRATION_POINTS_LIMIT, MIGRATION_TICKETS_LIMIT } from '../migration';

// 入力チェック(merge)。おうちの統合(A-07)・確認待ち(A-08)・旧カードの移行(A-05)

const idSchema = z.number().int().positive();

/** 同じ犬の組み合わせ。take は写真・名前・犬種をどちらから残すか。photo は写真だけ別に選ぶとき */
export const mergeDogPairSchema = z.object({
  keep: idSchema,
  absorb: idSchema,
  take: z.enum(['keep', 'absorb']),
  photo: z.enum(['keep', 'absorb']).optional(),
});

/** 統合の確認(POST /admin/api/merges/preview)と実行(POST /admin/api/merges)の入力 */
export const mergeInputSchema = z
  .object({
    /** 残すおうち */
    keepHouseholdId: idSchema,
    /** まとめるおうち(統合後は「統合済み」になる) */
    absorbHouseholdId: idSchema,
    dogPairs: z.array(mergeDogPairSchema).max(30).default([]),
  })
  .refine((v) => v.keepHouseholdId !== v.absorbHouseholdId, {
    error: '同じおうちどうしはまとめられません。まとめる相手のおうちを選び直してください。',
  });
export type MergeInput = z.infer<typeof mergeInputSchema>;

/**
 * お客さんが招待からおうちをまとめる(POST /api/invites/:code/merge、C-12)。
 * 自分のワンちゃんごとに、招待した側の同じ子(いなければ null)と、残す写真を選ぶ。
 * 一覧にないワンちゃんは、別の子として移す。
 */
export const customerMergeSchema = z.object({
  dogs: z
    .array(
      z.object({
        dogId: idSchema,
        sameAs: idSchema.nullable(),
        keepPhoto: z.enum(['mine', 'theirs']).default('theirs'),
      }),
    )
    .max(30, { error: 'ワンちゃんが多すぎます。受付にご相談ください。' })
    .default([]),
});
export type CustomerMergeInput = z.infer<typeof customerMergeSchema>;

/** 却下の理由(確認待ち、A-05・A-08)。選択式 */
export const REJECT_REASONS = {
  merge: ['同じ家族ではない', 'すでにまとめてある', 'お客さんから取り消しの連絡', 'その他'],
  migration: ['写真でポイントが確認できない', 'すでに引き継ぎ済み', 'お客さんから取り消しの連絡', 'その他'],
} as const;

/** 申請の却下(POST /admin/api/requests/:id/reject) */
export const rejectRequestSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, { error: '却下する理由を選んでください。' })
    .max(200, { error: '理由は200文字までで入力してください。' }),
});

const migrationSourceSchema = z.enum(MIGRATION_SOURCES, { error: '旧カードの種類(LINEのショップカード・紙のスタンプカード)を選んでください。' });
const migrationPointsSchema = z
  .number({ error: 'ポイント数を数字で入れてください。' })
  .int({ error: 'ポイント数は整数で入れてください。' })
  .min(0, { error: 'ポイント数は0以上の数で入れてください。' })
  .max(MIGRATION_POINTS_LIMIT, { error: `ポイント数は${MIGRATION_POINTS_LIMIT}以下の数で入れてください。` });

const CARD_CHECK_MESSAGE = '旧カードの確認に印を付けてください。';

/**
 * 旧カードの移行の直接入力(POST /admin/api/households/:id/migrate、A-05)。
 * 受付で旧カードを目で確かめたこと(confirmed_card)と、紙のカードを回収したか使用済みの印を付けたこと(collected_card)を必須にする(16.1)
 */
export const migrationInputSchema = z.object({
  source: migrationSourceSchema,
  /** だれのカードか(おうちの家族 = LINE アカウント)。カード1枚ごとに1回(2026-10-30 の決定) */
  member_id: z.number({ error: 'だれのカードかを選んでください。' }).int({ error: 'だれのカードかを選んでください。' }).positive({ error: 'だれのカードかを選んでください。' }),
  /** 引き継ぐポイント(台帳に書く数)。設定の上限まで */
  points: migrationPointsSchema,
  confirmed_card: z.literal(true, { error: CARD_CHECK_MESSAGE }),
  collected_card: z.literal(true, { error: CARD_CHECK_MESSAGE }),
  /** 旧カードに残っていたポイント(上限で切る前の数。上限を超えたときだけ points と違う)。任意 */
  card_points: z
    .number({ error: '旧カードのポイント数を数字で入れてください。' })
    .int({ error: '旧カードのポイント数は整数で入れてください。' })
    .min(0, { error: '旧カードのポイント数は0以上の数で入れてください。' })
    .max(MIGRATION_CARD_POINTS_LIMIT, { error: `旧カードのポイント数は${MIGRATION_CARD_POINTS_LIMIT}以下の数で入れてください。` })
    .optional(),
  /** 旧カードの使っていない特典(LINEのショップカードの特典チケット、ゴールまでたまって使っていない紙のカード)の枚数。無料券にする */
  tickets: z
    .number({ error: '特典の枚数を数字で入れてください。' })
    .int({ error: '特典の枚数は整数で入れてください。' })
    .min(0, { error: '特典の枚数は0以上の数で入れてください。' })
    .max(MIGRATION_TICKETS_LIMIT, { error: `特典の枚数は${MIGRATION_TICKETS_LIMIT}枚以下で入れてください。` })
    .default(0),
  /** 紙のカードの番号など(任意)。同じカードがほかのおうちで引き継がれていないかを確かめる */
  card_ref: z.string().trim().max(40, { error: 'カードの番号は40文字までで入れてください。' }).optional(),
  /** 受付のメモ(任意) */
  note: z.string().trim().max(200, { error: 'メモは200文字までで入れてください。' }).optional(),
  /** 同じカードの番号がほかのおうちにあると分かったうえで引き継ぐとき true */
  duplicate_ok: z.boolean().optional(),
  /** 移行期間のあとに受け付けるときの理由(設定 migration_late_entry が「受け付ける」のときだけ使える) */
  late_reason: z.string().trim().max(200, { error: '理由は200文字までで入れてください。' }).optional(),
});
export type MigrationInput = z.infer<typeof migrationInputSchema>;

