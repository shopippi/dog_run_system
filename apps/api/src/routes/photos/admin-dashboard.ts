import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { notImplemented } from '../../lib/photos/availability';

// 段階1-D(配信)。PA-1 ダッシュボード(PA-7 写真販売の設定は、既存の GET / PATCH /admin/api/settings の photo_ の項目を使う)
export const adminPhotoDashboardRoutes = new Hono<AppEnv>();

const todo = async (): Promise<never> => {
  throw notImplemented();
};

// 今月の売上・枚数、販売終了が近いアルバム、最新の注文(→ PhotoDashboardResponse)
adminPhotoDashboardRoutes.get('/dashboard', todo);
