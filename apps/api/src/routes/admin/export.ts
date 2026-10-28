import { Hono } from 'hono';
import type { AppEnv } from '../../env';

// A-14 CSV出力
export const exportRoutes = new Hono<AppEnv>();
