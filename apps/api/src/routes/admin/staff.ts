import { Hono } from 'hono';
import type { AppEnv } from '../../env';

// A-13 スタッフの管理
export const staffRoutes = new Hono<AppEnv>();
