// 入力チェック(settings)。ルールの設定(A-12)・犬種(A-11)・アンケート(A-10)・スタッフ(A-13)・
// イベントと休業日(A-09)・CSV出力(A-14)。
import { z } from 'zod';
import { LIFF_ID_MESSAGE, settingsSchema, type SettingKey, type Settings } from '../settings';

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
  migration_max_points: { label: '旧カードから引き継げるポイントの上限', hint: '1〜200の数で入れてください。' },
  developer_contact: { label: '製作者の連絡先', hint: '500文字までで入れてください。' },
  terms_text: { label: '利用規約', hint: '20,000文字までで入れてください。' },
  privacy_text: { label: 'プライバシーポリシー', hint: '20,000文字までで入れてください。' },
  liff_id: { label: 'LINEミニアプリの番号', hint: LIFF_ID_MESSAGE },
  merge_keep_same_day_points: { label: 'おうちをまとめたとき、同じ日の来場のポイント', hint: '残すか残さないかを選んでください。' },
  weather_station: { label: '天気の観測地点', hint: '気象庁の地点番号(5桁)と名前を入れてください。' },
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
  // 項目に日本語の文が付いていれば、それを出す(付いていなければ、項目ごとの入れ方の説明)
  const own = issue?.message && /[ぁ-んァ-ヶ一-龠]/.test(issue.message) ? issue.message : field.hint;
  return { ok: false, message: `「${field.label}」は、${own}`, key };
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
export const SURVEY_KIND_LABELS = { choice: '選ぶ', text: '自由に書く', multi: 'いくつでも選ぶ' } as const;
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
const surveyKindSchema = z.enum(['choice', 'text', 'multi'], { error: '答え方(選ぶ・いくつでも選ぶ・自由に書く)を選んでください。' });

const NEED_OPTIONS = '「選ぶ」「いくつでも選ぶ」の質問には、選択肢を2つ以上入れてください。';

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
    if (v.kind !== 'text' && v.options.length < 2) ctx.addIssue({ code: 'custom', path: ['options'], message: NEED_OPTIONS });
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

// ============================================================
// A-13 スタッフの管理
// ============================================================

/** 管理画面のパスワードの長さ(apps/api/scripts/create-staff.mjs と同じ) */
export const STAFF_PASSWORD_MIN = 10;

const staffPasswordSchema = z
  .string({ error: 'パスワードを入力してください。' })
  .min(STAFF_PASSWORD_MIN, { error: `パスワードは${STAFF_PASSWORD_MIN}文字以上にしてください。` })
  .max(200, { error: 'パスワードは200文字までにしてください。' });

/** スタッフを追加する。製作者(見るだけ)は管理画面からは作れない(docs/deploy.md のコマンドで作る) */
export const staffCreateSchema = z.object({
  name: z
    .string({ error: '名前を入力してください。' })
    .trim()
    .min(1, { error: '名前を入力してください。' })
    .max(40, { error: '名前は40文字までで入力してください。' }),
  email: z.string().trim().toLowerCase().email({ error: 'メールアドレスの形を確かめてください。' }).max(200),
  role: z.enum(['staff', 'admin'], { error: '役割(受付スタッフ・管理者)を選んでください。' }),
  password: staffPasswordSchema,
});

/** 停止・再開 */
export const staffPatchSchema = z.object({
  status: z.enum(['active', 'suspended'], { error: '停止するか再開するかを選んでください。' }),
});

/** パスワードの再発行。password を送らなければ、ランダムに作って1回だけ返す */
export const staffPasswordResetSchema = z.object({ password: staffPasswordSchema.optional() });

// ============================================================
// A-09 イベント・休業日
// ============================================================

/** イベントの種類(画面ではここから選ぶ。分析ではイベントの日として同じに扱う) */
export const EVENT_KINDS = ['イベント', '貸し切り', '教室・講習', 'その他'] as const;

const dateSchema = z
  .string({ error: '日付を選んでください。' })
  .regex(/^(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, { error: '日付を選び直してください。' })
  .refine(
    (d) => {
      const t = new Date(`${d}T00:00:00Z`);
      return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
    },
    { error: '日付を選び直してください。' },
  );

/** 月("2026-10") */
export const monthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/, { error: '月を選び直してください。' });

export const eventCreateSchema = z.object({
  date: dateSchema,
  name: z
    .string({ error: 'イベントの名前を入力してください。' })
    .trim()
    .min(1, { error: 'イベントの名前を入力してください。' })
    .max(50, { error: 'イベントの名前は50文字までで入力してください。' }),
  kind: z.enum(EVENT_KINDS, { error: '種類を選んでください。' }).default('イベント'),
  memo: z.string().trim().max(500, { error: 'メモは500文字までで入力してください。' }).nullish(),
});

export const closureCreateSchema = z.object({
  date: dateSchema,
  note: z.string().trim().max(100, { error: '休業の理由は100文字までで入力してください。' }).nullish(),
});

// ============================================================
// A-14 CSV出力
// ============================================================

export const EXPORT_NAMES = ['households', 'members', 'dogs', 'visits', 'ledger', 'survey'] as const;
export type ExportName = (typeof EXPORT_NAMES)[number];

/** 出力の種類。period: 期間を指定できるか */
export const EXPORTS: Record<ExportName, { label: string; desc: string; period: boolean }> = {
  households: { label: 'おうち', desc: '会員ID・呼び名・ポイント・無料券・来場回数など。1おうち1行', period: false },
  members: { label: '家族', desc: 'LINEの名前・年代・性別・参加日など。1人1行', period: false },
  dogs: { label: 'ワンちゃん', desc: '犬ID・名前・犬種・サイズ・来場回数など。1頭1行', period: false },
  visits: { label: '来場', desc: '来場日・時刻・来たワンちゃん・無料券・取り消しなど。1回の来場で1行', period: true },
  ledger: { label: 'ポイント台帳', desc: 'ポイントの増減と理由。1回の増減で1行', period: true },
  survey: { label: 'アンケートの回答', desc: '固定の質問と追加した質問の回答。1つの回答で1行', period: false },
};

/** 出力の期間(来場・ポイント台帳)。どちらも空なら、すべて */
export const exportQuerySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: '期間の始めの日を選び直してください。' }).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: '期間の終わりの日を選び直してください。' }).optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { error: '期間の終わりの日は、始めの日より後にしてください。' });
