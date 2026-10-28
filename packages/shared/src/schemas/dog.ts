import { z } from 'zod';
import { DOG_NAME_MAX, DOG_SEXES, DOG_SIZES, NEUTERED_VALUES } from '../constants';

// 犬の登録項目(要件定義書 6.1)。画面と API で同じ定義を使う。

export const dogNameSchema = z
  .string({ error: 'ワンちゃんの名前を入力してください。' })
  .trim()
  .min(1, { error: 'ワンちゃんの名前を入力してください。' })
  .max(DOG_NAME_MAX, { error: `ワンちゃんの名前は${DOG_NAME_MAX}文字までで入力してください。` });

export const birthYmSchema = z
  .string()
  .regex(/^(19|20)\d{2}-(0[1-9]|1[0-2])$/, { error: '生まれた年月を選び直してください。' });

export const dogInputSchema = z.object({
  name: dogNameSchema,
  breedId: z.number({ error: '犬種を選んでください。' }).int().positive({ error: '犬種を選んでください。' }),
  /** 犬種で「その他」を選んだときの自由入力 */
  breedOther: z
    .string()
    .trim()
    .max(30, { error: '犬種は30文字までで入力してください。' })
    .nullish(),
  size: z.enum(DOG_SIZES, { error: 'サイズ(小型・中型・大型)を選んでください。' }),
  sex: z.enum(DOG_SEXES).nullish(),
  birthYm: birthYmSchema.nullish(),
  neutered: z.enum(NEUTERED_VALUES).nullish(),
});
export type DogInput = z.infer<typeof dogInputSchema>;

export const MAX_DOGS_AT_REGISTER = 10;

/** 写真の大きさ(要件定義書 6.2)。長い辺 800px に縮小し、一覧用に正方形の小さな写真も作る。 */
export const PHOTO_MAX_EDGE = 800;
export const THUMB_EDGE = 240;
export const PHOTO_MAX_BYTES = 1_000_000;
export const THUMB_MAX_BYTES = 200_000;
