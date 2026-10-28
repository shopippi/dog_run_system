import { Hono } from 'hono';
import type { AppEnv } from '../../env';

// A-09 イベント・休業日
export const eventsRoutes = new Hono<AppEnv>();
