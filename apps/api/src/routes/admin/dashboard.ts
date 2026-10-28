import { Hono } from 'hono';
import type { AppEnv } from '../../env';

// A-01 ダッシュボード
export const dashboardRoutes = new Hono<AppEnv>();
