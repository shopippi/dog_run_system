import { Hono } from 'hono';
import type { AppEnv } from '../../env';

// A-12 ルールの設定
export const settingsRoutes = new Hono<AppEnv>();
