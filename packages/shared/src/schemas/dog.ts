import { z } from 'zod';
import { DOG_NAME_MAX, DOG_SEXES, DOG_SIZES, DOG_SOCIABILITY, DOG_WEIGHT_MAX, DOG_WEIGHT_MIN, VACCINE_YEAR_MIN } from '../constants';
import { toJstDate } from '../date';

// 犬の登録項目(要件定義書 6.1)。画面と API で同じ定義を使う。

export const dogNameSchema = z
  .string({ error: 'ワンちゃんの名前を入力してください。' })
  .trim()
  .min(1, { error: 'ワンちゃんの名前を入力してください。' })
  .max(DOG_NAME_MAX, { error: `ワンちゃんの名前は${DOG_NAME_MAX}文字までで入力してください。` });

export const birthYmSchema = z
  .string()
  .regex(/^(19|20)\d{2}-(0[1-9]|1[0-2])$/, { error: '生まれた年月を選び直してください。' });

/** 体重(kg)。0.1〜100.0 の小数1桁 */
export const dogWeightSchema = z
  .number({ error: `体重は${DOG_WEIGHT_MIN}から${DOG_WEIGHT_MAX}までの数字で入力してください(例: 5.2)。` })
  .min(DOG_WEIGHT_MIN, { error: `体重は${DOG_WEIGHT_MIN}から${DOG_WEIGHT_MAX}までの数字で入力してください(例: 5.2)。` })
  .max(DOG_WEIGHT_MAX, { error: `体重は${DOG_WEIGHT_MIN}から${DOG_WEIGHT_MAX}までの数字で入力してください(例: 5.2)。` })
  .refine((v) => Math.abs(Math.round(v * 10) - v * 10) < 1e-6, { error: '体重は小数1桁まで(例: 5.2)で入力してください。' });

/** 今年(日本時間) */
export const currentJstYear = (now: Date = new Date()) => Number(toJstDate(now).slice(0, 4));

/** 狂犬病の予防注射・混合ワクチンの年。2000年から今年まで */
export const vaccineYearSchema = z
  .number({ error: '予防注射の年を選び直してください。' })
  .int({ error: '予防注射の年を選び直してください。' })
  .min(VACCINE_YEAR_MIN, { error: `予防注射の年は${VACCINE_YEAR_MIN}年から今年までで選んでください。` })
  .refine((y) => y <= currentJstYear(), { error: `予防注射の年は${VACCINE_YEAR_MIN}年から今年までで選んでください。` });

/** 2026-10-28 に足した、任意の項目(体重・ほかの犬との相性・予防注射の年)。お客さんも管理者も変えられる */
export const dogExtraSchema = z.object({
  weightKg: dogWeightSchema.nullish(),
  sociability: z.enum(DOG_SOCIABILITY, { error: 'ほかの犬との相性を選び直してください。' }).nullish(),
  rabiesVaccineYear: vaccineYearSchema.nullish(),
  comboVaccineYear: vaccineYearSchema.nullish(),
});
export type DogExtra = z.infer<typeof dogExtraSchema>;

/** 画面の体重の入力(文字)を数字にする。全角も受け付け、空なら null。読めなければ NaN(入力チェックで日本語のメッセージを出す) */
export function parseWeightInput(text: string): number | null {
  const t = text.normalize('NFKC').trim().replace(/kg$/i, '').trim();
  if (t === '') return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

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
  ...dogExtraSchema.shape,
});
export type DogInput = z.infer<typeof dogInputSchema>;

export const MAX_DOGS_AT_REGISTER = 10;

/** 写真の大きさ(要件定義書 6.2)。長い辺 800px に縮小し、一覧用に正方形の小さな写真も作る。 */
export const PHOTO_MAX_EDGE = 800;
export const THUMB_EDGE = 240;
export const PHOTO_MAX_BYTES = 1_000_000;
export const THUMB_MAX_BYTES = 200_000;

/** お客さんが変えられる項目(C-08)。犬種とサイズは管理者だけが変えられる(6.1)。 */
export const dogPatchSchema = z
  .object({
    name: dogNameSchema,
    sex: z.enum(DOG_SEXES).nullable(),
    birthYm: birthYmSchema.nullable(),
    weightKg: dogWeightSchema.nullable(),
    sociability: z.enum(DOG_SOCIABILITY, { error: 'ほかの犬との相性を選び直してください。' }).nullable(),
    rabiesVaccineYear: vaccineYearSchema.nullable(),
    comboVaccineYear: vaccineYearSchema.nullable(),
  })
  .partial();
export type DogPatch = z.infer<typeof dogPatchSchema>;
