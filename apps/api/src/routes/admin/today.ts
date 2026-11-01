import { toJstDate, type TodayResponse } from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { serveMedia } from '../../services/dogs';
import { ADMIN_MEDIA_BASE, canSeePersonal, listVisitsOn, totalsOf } from '../../services/admin-visits';

export const todayRoutes = new Hono<AppEnv>();

// 今日の来場(S-02)。受付スタッフ・管理者・製作者が見られる
todayRoutes.get('/today', async (c) => {
  const db = c.env.DB;
  const staff = c.get('staff');
  const date = toJstDate(c.get('now'));
  const visits = await listVisitsOn(db, date, staff.role);
  let pendingRequests: number | null = null;
  if (canSeePersonal(staff.role)) {
    // 以前の「まとめる申請」(kind 'merge')は数えない(お客さんが招待から自分でまとめる形になったため)
    const row = await db.prepare("SELECT COUNT(*) AS n FROM requests WHERE status = 'pending' AND kind <> 'merge'").first<{ n: number }>();
    pendingRequests = row?.n ?? 0;
  }
  const body: TodayResponse = { date, visits, totals: totalsOf(visits), pendingRequests };
  return c.json(body);
});

// 犬の写真・添付画像(S-02)。ログインしている人だけが見られる。誰でも開ける URL にはしない
todayRoutes.get('/media/*', async (c) => {
  const key = decodeURIComponent(c.req.path.slice(`${ADMIN_MEDIA_BASE}/`.length));
  if (!/^(dogs|requests)\//.test(key) || key.includes('..')) throw errors.notFound('写真が見つかりませんでした。画面を読み込み直してください。');
  return serveMedia(c.env.MEDIA, key, c.req.header('if-none-match'));
});
