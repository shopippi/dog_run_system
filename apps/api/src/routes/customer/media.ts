import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { isHouseholdDogMedia, serveMedia } from '../../services/dogs';
import { requireMember } from '../../services/members';

/** お客さん向けの写真の URL の頭(認証つき) */
export const MEDIA_BASE = '/api/media';

export const mediaRoutes = new Hono<AppEnv>();

// 自分のおうちの犬の写真だけを返す(C-06)
mediaRoutes.get('/media/*', async (c) => {
  const key = decodeURIComponent(c.req.path.slice(`${MEDIA_BASE}/`.length));
  const member = await requireMember(c.env.DB, c.get('lineUser').userId);
  if (!key || !(await isHouseholdDogMedia(c.env.DB, member.householdId, key))) {
    throw errors.notFound('写真が見つかりませんでした。画面を読み込み直してください。');
  }
  return serveMedia(c.env.MEDIA, key);
});
