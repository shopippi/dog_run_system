import type { HouseholdSearchResponse } from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { recentHouseholds, searchHouseholds } from '../../services/search';

export const householdRoutes = new Hono<AppEnv>();

// おうちの検索(S-06)。q がなければ、最近来たおうち(写真で探す)
householdRoutes.get('/households', async (c) => {
  const role = c.get('staff').role;
  const q = (c.req.query('q') ?? '').slice(0, 50);
  const households = q.trim() ? await searchHouseholds(c.env.DB, q, role) : await recentHouseholds(c.env.DB, role);
  const body: HouseholdSearchResponse = { households };
  return c.json(body);
});
