import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { requireRole } from '../../lib/staff-auth';

// A-05 旧カードの移行の承認・却下、A-08 まとめる申請の確認
export const requestsRoutes = new Hono<AppEnv>();

// 確認待ちの件数(メニューの印)。管理者と製作者
requestsRoutes.get('/requests/count', requireRole('admin'), async (c) => {
  const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE status = 'pending'").first<{ n: number }>();
  return c.json({ pending: row?.n ?? 0 });
});
