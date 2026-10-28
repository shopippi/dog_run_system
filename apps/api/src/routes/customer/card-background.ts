import { cardPresetInputSchema, toCardBackgroundView, type CardBackgroundView } from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { parseJson } from '../../lib/validate';
import { loadCardBackground, saveCardBackground, saveCardPhoto } from '../../services/card-background';
import { requireMember } from '../../services/members';
import { MEDIA_BASE } from './media';

/** 会員証の背景(C-06、L-07b)。おうちの家族の誰でも変えられる。変更は操作ログに残す */
export const cardBackgroundRoutes = new Hono<AppEnv>();

const view = (bg: Parameters<typeof toCardBackgroundView>[0]): { cardBackground: CardBackgroundView } => ({
  cardBackground: toCardBackgroundView(bg, MEDIA_BASE),
});

// いまの背景
cardBackgroundRoutes.get('/me/card-background', async (c) => {
  const member = await requireMember(c.env.DB, c.get('lineUser').userId);
  return c.json(view(await loadCardBackground(c.env.DB, member.householdId)));
});

// 単色を選ぶ
cardBackgroundRoutes.put('/me/card-background', async (c) => {
  const member = await requireMember(c.env.DB, c.get('lineUser').userId);
  const input = await parseJson(c, cardPresetInputSchema);
  const saved = await saveCardBackground(
    c.env.DB,
    member.householdId,
    member.memberId,
    { kind: 'preset', color: input.color },
    c.get('now'),
  );
  return c.json(view(saved));
});

// 写真を使う(スマホで縮小した写真。2MB まで)
cardBackgroundRoutes.post('/me/card-background/photo', async (c) => {
  const member = await requireMember(c.env.DB, c.get('lineUser').userId);
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw errors.badRequest('写真を受け取れませんでした。写真を選び直して、もう一度お試しください。');
  }
  const photo = await saveCardPhoto(c.env.MEDIA, member.householdId, form);
  const saved = await saveCardBackground(c.env.DB, member.householdId, member.memberId, photo, c.get('now'));
  return c.json(view(saved));
});

// 写真をやめる(墨の単色に戻す。写真のファイルは消さずに残す)
cardBackgroundRoutes.delete('/me/card-background/photo', async (c) => {
  const member = await requireMember(c.env.DB, c.get('lineUser').userId);
  const current = await loadCardBackground(c.env.DB, member.householdId);
  if (current.kind !== 'photo') return c.json(view(current));
  const saved = await saveCardBackground(
    c.env.DB,
    member.householdId,
    member.memberId,
    { kind: 'preset', color: 'ink' },
    c.get('now'),
  );
  return c.json(view(saved));
});
