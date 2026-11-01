import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { notImplemented } from '../../lib/photos/availability';

// 段階1-A(管理)。PA-5 価格表・PF-3 価格表
// 価格表を変えると、使っているアルバムにすぐ反映する(お支払い済みの注文は order_items の価格のまま)。物理削除しない(status = 'archived')。
export const adminPriceListRoutes = new Hono<AppEnv>();

const todo = async (): Promise<never> => {
  throw notImplemented();
};

// 一覧(→ PriceListsResponse)
adminPriceListRoutes.get('/price-lists', todo);
// 作る(priceListCreateSchema → { priceList: PriceList })
adminPriceListRoutes.post('/price-lists', todo);
// 種類ごとの既定(priceListDefaultsSchema → PriceListsResponse)
adminPriceListRoutes.put('/price-lists/defaults', todo);
// 変える・使わなくする(priceListUpdateSchema → { priceList: PriceList })
adminPriceListRoutes.patch('/price-lists/:id', todo);
