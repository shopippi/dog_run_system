import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { photoDashboard } from '../../services/photos/dashboard';

// 段階1-D(配信)。PA-1 ダッシュボード(PA-7 写真販売の設定は、既存の GET / PATCH /admin/api/settings の photo_ の項目を使う)
// 管理者と製作者(見るだけ)が見られる。受付スタッフは 403(index.ts の requireRole('admin'))
export const adminPhotoDashboardRoutes = new Hono<AppEnv>();

// 今月の売上・枚数、販売終了が近いアルバム、最新の注文(→ PhotoDashboardResponse)
adminPhotoDashboardRoutes.get('/dashboard', async (c) => c.json(await photoDashboard(c.env, c.get('now'))));
