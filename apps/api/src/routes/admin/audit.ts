import { Hono } from 'hono';
import type { AppEnv } from '../../env';

// A-15 操作ログと元に戻す
export const auditRoutes = new Hono<AppEnv>();
