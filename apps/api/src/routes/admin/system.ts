import { Hono } from 'hono';
import type { AppEnv } from '../../env';

// A-17・D-02 システムの状態、B-02 祝日データの手動取り込み
export const systemRoutes = new Hono<AppEnv>();
