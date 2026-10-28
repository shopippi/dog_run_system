import { Hono } from 'hono';
import type { AppEnv } from '../../env';

// C-07 来場履歴
export const historyRoutes = new Hono<AppEnv>();
