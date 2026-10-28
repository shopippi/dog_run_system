import { Hono } from 'hono';
import type { AppEnv } from '../../env';

// A-11 犬種の選択肢の管理
export const breedsRoutes = new Hono<AppEnv>();
