// 会員証の背景(C-06、docs/design.md 5章「会員証(L-07)」「背景を変える(L-07b)」)。
// おうちで共通。households.card_background に JSON で持つ。null は初期値(墨の単色)。
import { z } from 'zod';
import { AUDIT_ACTION_LABELS } from './api-types-households';

/** 単色のプリセット(並び順は画面のチップの順) */
export const CARD_PRESET_COLORS = ['ink', 'navy', 'forest', 'brown', 'wine', 'gray', 'sand', 'white'] as const;
export type CardPresetColor = (typeof CARD_PRESET_COLORS)[number];

/** 画面に出す色の名前 */
export const CARD_PRESET_LABELS: Record<CardPresetColor, string> = {
  ink: '墨',
  navy: '紺',
  forest: '深緑',
  brown: '茶',
  wine: 'ワイン',
  gray: '灰',
  sand: '砂',
  white: '白',
};

/** 明るい単色(影を重ねず、文字を濃い色にする) */
export const CARD_LIGHT_PRESETS: readonly CardPresetColor[] = ['sand', 'white'];

/** 写真の大きさの上限(サーバーで確かめる)。スマホでは長い辺 1200px 以下に縮小して送る */
export const CARD_PHOTO_MAX_BYTES = 1_800_000;
export const CARD_PHOTO_MAX_EDGE = 1200;

/** データベースに保存する形 */
export const cardBackgroundSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('preset'), color: z.enum(CARD_PRESET_COLORS) }),
  z.object({ kind: z.literal('photo'), key: z.string().regex(/^cards\/\d+\/[0-9a-f-]{36}\.(jpg|png|webp)$/) }),
]);
export type CardBackground = z.infer<typeof cardBackgroundSchema>;

export const DEFAULT_CARD_BACKGROUND: CardBackground = { kind: 'preset', color: 'ink' };

/** 画面に返す形。写真は認証つきの API の URL(誰でも開ける URL にしない) */
export type CardBackgroundView = { kind: 'preset'; color: CardPresetColor } | { kind: 'photo'; url: string };

/** PUT /api/me/card-background(単色を選ぶ) */
export const cardPresetInputSchema = z.object({
  color: z.enum(CARD_PRESET_COLORS, { error: '色を選び直してください。' }),
});
export type CardPresetInput = z.infer<typeof cardPresetInputSchema>;

/** 保存された JSON を読む。読めないときや空のときは初期値(墨) */
export function parseCardBackground(raw: string | null | undefined): CardBackground {
  if (!raw) return DEFAULT_CARD_BACKGROUND;
  try {
    const parsed = cardBackgroundSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_CARD_BACKGROUND;
  } catch {
    return DEFAULT_CARD_BACKGROUND;
  }
}

export function toCardBackgroundView(bg: CardBackground, mediaBase: string): CardBackgroundView {
  return bg.kind === 'photo' ? { kind: 'photo', url: `${mediaBase}/${bg.key}` } : bg;
}

/** 管理画面(M-06)に出す、背景の種類だけの言葉(写真そのものは出さない) */
export function cardBackgroundLabel(bg: CardBackground): string {
  return bg.kind === 'photo' ? '写真' : `単色(${CARD_PRESET_LABELS[bg.color]})`;
}

// 操作ログ(A-15)の言葉
Object.assign(AUDIT_ACTION_LABELS, {
  'household.card_background': '会員証の背景の変更',
});
