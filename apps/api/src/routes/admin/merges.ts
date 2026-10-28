import { Hono } from 'hono';
import type { AppEnv } from '../../env';

// A-07 おうちの統合
export const mergesRoutes = new Hono<AppEnv>();
