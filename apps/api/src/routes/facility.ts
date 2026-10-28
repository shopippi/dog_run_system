import type { FacilityResponse } from '@dr/shared';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { loadSettings } from '../lib/settings';

/**
 * 施設の名前だけを返す(認証なし)。画面の見出し「○○ 会員証」「○○ 受付・管理」に使う。
 * ログインの前の画面でも読めるよう、お客さん向け(/api)と管理画面向け(/admin/api)の両方に置く。
 * ほかの設定は返さない。
 */
export async function facilityHandler(c: Context<AppEnv>) {
  const settings = await loadSettings(c.env.DB);
  const body: FacilityResponse = { facilityName: settings.facility_name };
  c.header('cache-control', 'no-store');
  return c.json(body);
}
