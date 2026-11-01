import { priceListCreateSchema, priceListDefaultsSchema, priceListUpdateSchema, type PriceListsResponse } from '@dr/shared';
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../../env';
import { parseJson } from '../../lib/validate';
import { createPriceList, listPriceLists, setDefaults, updatePriceList } from '../../services/photos/admin-price-lists';
import { toId } from '../../services/photos/admin-common';

// 段階1-A(管理)。PA-5 価格表・PF-3 価格表
// 価格表を変えると、使っているアルバムにすぐ反映する(お支払い済みの注文は order_items の価格のまま)。物理削除しない(status = 'archived')。
// 応答の形は凍結したもののまま。元に戻すのは操作ログの画面から。
export const adminPriceListRoutes = new Hono<AppEnv>();

const ctxOf = (c: Context<AppEnv>) => ({ staffId: c.get('staff').id, now: c.get('now') });

// 一覧(→ PriceListsResponse)
adminPriceListRoutes.get('/price-lists', async (c) => {
  const body: PriceListsResponse = { priceLists: await listPriceLists(c.env.DB) };
  return c.json(body);
});
// 作る(priceListCreateSchema → { priceList: PriceList })
adminPriceListRoutes.post('/price-lists', async (c) => {
  const input = await parseJson(c, priceListCreateSchema);
  const { priceList } = await createPriceList(c.env.DB, input, ctxOf(c));
  return c.json({ priceList }, 201);
});
// 種類ごとの既定(priceListDefaultsSchema → PriceListsResponse)
adminPriceListRoutes.put('/price-lists/defaults', async (c) => {
  const input = await parseJson(c, priceListDefaultsSchema);
  await setDefaults(c.env.DB, input, ctxOf(c));
  const body: PriceListsResponse = { priceLists: await listPriceLists(c.env.DB) };
  return c.json(body);
});
// 変える・使わなくする(priceListUpdateSchema → { priceList: PriceList })
adminPriceListRoutes.patch('/price-lists/:id', async (c) => {
  const input = await parseJson(c, priceListUpdateSchema);
  const { priceList } = await updatePriceList(c.env.DB, toId(c.req.param('id')), input, ctxOf(c));
  return c.json({ priceList });
});
