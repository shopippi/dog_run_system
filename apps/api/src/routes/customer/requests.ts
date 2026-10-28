import { Hono } from 'hono';
import type { AppEnv } from '../../env';

// C-10 旧カードの引き継ぎ申請
export const customerRequestRoutes = new Hono<AppEnv>();
