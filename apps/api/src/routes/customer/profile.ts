import { Hono } from 'hono';
import type { AppEnv } from '../../env';

// C-09 プロフィール
export const profileRoutes = new Hono<AppEnv>();
