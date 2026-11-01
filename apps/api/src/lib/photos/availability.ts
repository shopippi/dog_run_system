import {
  PHOTO_ERROR_CODES,
  PHOTO_NOT_IMPLEMENTED_MESSAGE,
  PHOTO_PAYMENTS_MISSING_MESSAGE,
  PHOTO_STORAGE_MISSING_MESSAGE,
  PHOTO_UNAVAILABLE_MESSAGE,
  type PhotoAvailability,
  type Settings,
} from '@dr/shared';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AppEnv, Bindings } from '../../env';
import { AppError } from '../errors';
import { loadSettings } from '../settings';
import { photoStorage, r2Config, type PhotoStorage } from './storage';
import { stripeClient, stripeLiveConfigured, stripeMockEnabled, type StripeClient } from './stripe';

// 写真販売が使えるか(docs/photo-requirements.md 2章の決定2・3)。
// 本番は、設定 photo_sales_enabled が on で、R2 と Stripe の設定がそろったときだけ、お客さんに見せる。
// local・test は、R2 の代わりの置き場所と、まねの Stripe(STRIPE_MOCK = "1")で動く。

export function photoAvailability(env: Bindings, settings: Pick<Settings, 'photo_sales_enabled'>): PhotoAvailability {
  const storage = r2Config(env) ? 'r2' : env.ENVIRONMENT === 'production' ? 'missing' : 'fallback';
  const payments = stripeMockEnabled(env) ? 'mock' : stripeLiveConfigured(env) ? 'live' : 'missing';
  const enabledSetting = settings.photo_sales_enabled;
  let message: string | null = null;
  if (storage === 'missing') message = PHOTO_STORAGE_MISSING_MESSAGE;
  else if (payments === 'missing') message = PHOTO_PAYMENTS_MISSING_MESSAGE;
  else if (!enabledSetting) message = '写真の販売は止めています。始めるときは、写真販売の設定で「販売する」を選んでください。';
  return { available: message === null, enabledSetting, storage, payments, message };
}

/** 準備中(お客さん向け)。503 で、画面は「準備中」の表示にする */
export const photoUnavailable = () => new AppError(503, PHOTO_ERROR_CODES.unavailable, PHOTO_UNAVAILABLE_MESSAGE);

/** 段階0の骨組み(段階1で作る) */
export const notImplemented = () => new AppError(501, PHOTO_ERROR_CODES.notImplemented, PHOTO_NOT_IMPLEMENTED_MESSAGE);

/** お客さん向けの写真販売の API の前に置く。使えないときは 503 「準備中」 */
export const requirePhotoSales = createMiddleware<AppEnv>(async (c, next) => {
  const settings = await loadSettings(c.env.DB);
  if (!photoAvailability(c.env, settings).available) throw photoUnavailable();
  await next();
});

/** 写真の置き場所。無ければ 503(管理画面: 「写真の置き場所(R2)がまだ設定されていません」) */
export function requireStorage(c: Context<AppEnv>): PhotoStorage {
  const s = photoStorage(c.env);
  if (!s) throw new AppError(503, PHOTO_ERROR_CODES.storageNotConfigured, PHOTO_STORAGE_MISSING_MESSAGE);
  return s;
}

/** Stripe の窓口。無ければ 503 */
export function requireStripe(c: Context<AppEnv>): StripeClient {
  const s = stripeClient(c.env);
  if (!s) throw new AppError(503, PHOTO_ERROR_CODES.paymentsNotConfigured, PHOTO_PAYMENTS_MISSING_MESSAGE);
  return s;
}

/** 画面の URL を作るときの、このサーバーの頭(https://example.workers.dev) */
export function originOf(c: Context<AppEnv>): string {
  return new URL(c.req.url).origin;
}
