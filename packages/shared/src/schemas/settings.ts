// 入力チェック(settings)。ルールの設定(A-12)・犬種(A-11)・アンケート(A-10)・スタッフ(A-13)・
// イベントと休業日(A-09)・CSV出力(A-14)。
import { z } from 'zod';
import { settingsSchema, type SettingKey, type Settings } from '../settings';

// ============================================================
// A-12 ルールの設定
// ============================================================

/** 設定の項目の名前と、入れられる値の説明(エラーの文に使う) */
export const SETTING_FIELDS: Record<SettingKey, { label: string; hint: string }> = {
  points_per_ticket: { label: '無料券1枚に必要なポイント数', hint: '1〜100の数で入れてください。' },
  daily_point_limit: { label: '1日にもらえるポイントの上限', hint: '1〜10の数で入れてください。' },
  grant_point_on_ticket_day: { label: '無料券を使った日のポイント', hint: '付けるか付けないかを選んでください。' },
  point_expiry: { label: 'ポイントの有効期限', hint: '期限なしか、1〜120か月で選んでください。' },
  ticket_expiry: { label: '無料券の有効期限', hint: '期限なしか、1〜120か月で選んでください。' },
  repeat_days: { label: 'リピート率の日数', hint: '1〜365日で入れてください。' },
  dormant_days: { label: '休眠とみなす日数', hint: '1〜730日で入れてください。' },
  dormant_min_visits: { label: '常連とみなす来場回数', hint: '1〜100回で入れてください。' },
  checkin_passphrase: { label: '受付のQRコードの合言葉', hint: '8〜64文字で入れてください。' },
  invite_ttl_hours: { label: '家族の招待の有効時間', hint: '1〜168時間で入れてください。' },
  reception_invite_ttl_minutes: { label: '受付で出す招待QRの有効時間', hint: '1〜120分で入れてください。' },
  migration_period: { label: '移行期間', hint: '開始日と終了日を選び直してください。終了日は開始日より後にしてください。' },
  developer_contact: { label: '製作者の連絡先', hint: '500文字までで入れてください。' },
  terms_text: { label: '利用規約', hint: '20,000文字までで入れてください。' },
  privacy_text: { label: 'プライバシーポリシー', hint: '20,000文字までで入れてください。' },
  liff_id: { label: 'LINEミニアプリの番号', hint: '半角の英数字とハイフンだけで入れてください。' },
};

const ymd = /^\d{4}-\d{2}-\d{2}$/;

/** 設定の変更(PATCH /admin/api/settings)。変える項目だけを送る */
export const settingsPatchSchema = z
  .strictObject(settingsSchema.partial().shape)
  .superRefine((v, ctx) => {
    const p = v.migration_period;
    if (!p) return;
    if ((p.start && !ymd.test(p.start)) || (p.end && !ymd.test(p.end)) || (p.start && p.end && p.start > p.end)) {
      ctx.addIssue({ code: 'custom', path: ['migration_period'], message: 'invalid' });
    }
  });
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** 設定の変更を確かめる。だめなときは、どの項目をどう直せばよいかを日本語で返す(画面と API で共有) */
export function checkSettingsPatch(
  input: unknown,
): { ok: true; data: Partial<Settings> } | { ok: false; message: string; key?: string } {
  const r = settingsPatchSchema.safeParse(input);
  if (r.success) return { ok: true, data: r.data as Partial<Settings> };
  const issue = r.error.issues[0];
  const key = (issue?.code === 'unrecognized_keys' ? undefined : issue?.path[0]) as SettingKey | undefined;
  const field = key ? SETTING_FIELDS[key] : undefined;
  if (!field) return { ok: false, message: '変えられない項目が含まれています。画面を読み込み直して、もう一度お試しください。' };
  return { ok: false, message: `「${field.label}」は、${field.hint}`, key };
}

/** 受付の固定QRコードに入れる URL。LINEミニアプリの番号がなければ、同じドメインの /liff/ を指す(相対 URL) */
export function checkinUrlFor(liffId: string, passphrase: string): string {
  const k = encodeURIComponent(passphrase);
  return liffId ? `https://liff.line.me/${liffId}/checkin?k=${k}` : `/liff/checkin?k=${k}`;
}

// ============================================================
// A-11 犬種の選択肢
// ============================================================

export const BREED_NAME_MAX = 30;

const breedNameSchema = z
  .string({ error: '犬種の名前を入力してください。' })
  .trim()
  .min(1, { error: '犬種の名前を入力してください。' })
  .max(BREED_NAME_MAX, { error: `犬種の名前は${BREED_NAME_MAX}文字までで入力してください。` });
const breedSizeSchema = z.enum(['small', 'medium', 'large'], { error: '標準のサイズ(小型・中型・大型)を選んでください。' });

/** 犬種を追加する */
export const breedCreateSchema = z.object({ name: breedNameSchema, defaultSize: breedSizeSchema });

/** 犬種の名前・標準のサイズ・表示するかを変える */
export const breedPatchSchema = z
  .object({ name: breedNameSchema, defaultSize: breedSizeSchema, visible: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: '変える内容がありません。画面を読み込み直してください。' });

/** 並べ替え。並べたい順の番号の配列(「その他」は含めない。常に最後) */
export const orderSchema = z.object({
  ids: z.array(z.number().int().positive()).max(500),
});

// ============================================================
// A-10 アンケートの管理
// ============================================================

export const SURVEY_TARGET_LABELS = { member: '家族一人ひとり', household: 'おうちごと' } as const;
export const SURVEY_KIND_LABELS = { choice: '選ぶ', text: '自由に書く' } as const;
export const SURVEY_LABEL_MAX = 100;
export const SURVEY_OPTION_MAX = 50;
export const SURVEY_OPTIONS_MAX = 20;

const questionLabelSchema = z
  .string({ error: '質問の文を入力してください。' })
  .trim()
  .min(1, { error: '質問の文を入力してください。' })
  .max(SURVEY_LABEL_MAX, { error: `質問の文は${SURVEY_LABEL_MAX}文字までで入力してください。` });

/** 選択肢。前後の空白と空の行は除き、同じものは1つにする */
const questionOptionsSchema = z
  .array(z.string().trim().max(SURVEY_OPTION_MAX, { error: `選択肢は1つ${SURVEY_OPTION_MAX}文字までで入力してください。` }))
  .transform((xs) => [...new Set(xs.filter((x) => x !== ''))])
  .refine((xs) => xs.length <= SURVEY_OPTIONS_MAX, { error: `選択肢は${SURVEY_OPTIONS_MAX}個までにしてください。` });

const surveyTargetSchema = z.enum(['member', 'household'], { error: '聞く相手を選んでください。' });
const surveyKindSchema = z.enum(['choice', 'text'], { error: '答え方(選ぶ・自由に書く)を選んでください。' });

const NEED_OPTIONS = '「選ぶ」の質問には、選択肢を2つ以上入れてください。';

/** 質問を追加する(7.2) */
export const surveyQuestionCreateSchema = z
  .object({
    target: surveyTargetSchema,
    kind: surveyKindSchema,
    label: questionLabelSchema,
    options: questionOptionsSchema.default([]),
    required: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'choice' && v.options.length < 2) ctx.addIssue({ code: 'custom', path: ['options'], message: NEED_OPTIONS });
  })
  .transform((v) => ({ ...v, options: v.kind === 'text' ? [] : v.options }));
export type SurveyQuestionCreate = z.infer<typeof surveyQuestionCreateSchema>;

/** 質問を変える。固定の質問は、文と選択肢だけ変えられる(7.1) */
export const surveyQuestionPatchSchema = z
  .object({
    target: surveyTargetSchema,
    kind: surveyKindSchema,
    label: questionLabelSchema,
    options: questionOptionsSchema,
    required: z.boolean(),
    visible: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: '変える内容がありません。画面を読み込み直してください。' });
export type SurveyQuestionPatch = z.infer<typeof surveyQuestionPatchSchema>;
export const SURVEY_NEED_OPTIONS_MESSAGE = NEED_OPTIONS;
