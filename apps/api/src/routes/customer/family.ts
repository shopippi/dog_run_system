import { Hono } from 'hono';
import type { AppEnv } from '../../env';

// C-13 家族の一覧・抜ける
export const familyRoutes = new Hono<AppEnv>();
