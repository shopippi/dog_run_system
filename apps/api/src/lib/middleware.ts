import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';
import { errors } from './errors';
import { verifyLineIdToken } from './line';

/**
 * 現在時刻を決める。テストと開発では x-debug-now ヘッダーで時刻を指定できる
 * (日付をまたぐ動作や、招待の期限切れを確かめるため)。本番では無視する。
 */
export const nowMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const override = c.req.header('x-debug-now');
  if (override && c.env.ENVIRONMENT !== 'production') {
    const d = new Date(override);
    c.set('now', Number.isNaN(d.getTime()) ? new Date() : d);
  } else {
    c.set('now', new Date());
  }
  await next();
});

/** お客さん向け API。LINE の IDトークンを毎回サーバー側で検証する。 */
export const requireLineUser = createMiddleware<AppEnv>(async (c, next) => {
  const auth = c.req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) throw errors.unauthorized();
  const user = await verifyLineIdToken(c.env, token);
  if (!user) throw errors.unauthorized();
  c.set('lineUser', user);
  await next();
});
