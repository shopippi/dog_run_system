import { z } from 'zod';
import { MIGRATION_SOURCES } from '../constants';
import { MIGRATION_POINTS_LIMIT } from '../migration';

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
  points: migrationPointsSchema,
  confirmed_card: z.literal(true, { error: CARD_CHECK_MESSAGE }),
  collected_card: z.literal(true, { error: CARD_CHECK_MESSAGE }),
});
export type MigrationInput = z.infer<typeof migrationInputSchema>;

