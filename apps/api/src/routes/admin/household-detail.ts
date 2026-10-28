import { Hono } from 'hono';
import type { AppEnv } from '../../env';

// A-02 おうちの詳細・呼び名の変更、A-03 ポイントの手動登録、A-04 犬の情報の変更、A-06 家族の追加・解除
export const householdDetailRoutes = new Hono<AppEnv>();
