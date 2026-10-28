import { Hono } from 'hono';
import type { AppEnv } from './env';
import { AppError, type ErrorBody } from './lib/errors';
import { nowMiddleware, requireLineUser } from './lib/middleware';
import { checkinRoutes } from './routes/customer/checkins';
import { dogRoutes } from './routes/customer/dogs';
import { inviteRoutes } from './routes/customer/invites';
import { joinRoutes } from './routes/customer/join';
import { meRoutes } from './routes/customer/me';
import { authRoutes } from './routes/admin/auth';
import { requireStaff } from './lib/staff-auth';
import { mediaRoutes } from './routes/customer/media';
import { surveyRoutes } from './routes/customer/survey';

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use('*', nowMiddleware);

  app.onError((err, c) => {
    if (err instanceof AppError) {
      const body: ErrorBody = { error: { code: err.code, message: err.message, details: err.details } };
      return c.json(body, err.status);
    }
    console.error(err);
    const body: ErrorBody = {
      error: {
        code: 'internal',
        message: 'うまく処理できませんでした。少し待ってから、もう一度お試しください。続くときは管理者に知らせてください。',
      },
    };
    return c.json(body, 500);
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  // お客さん向け API(LINE の IDトークンで認証)
  const customer = new Hono<AppEnv>();
  customer.use('*', requireLineUser);
  customer.route('/', meRoutes);
  customer.route('/', dogRoutes);
  customer.route('/', mediaRoutes);
  customer.route('/', surveyRoutes);
  customer.route('/', checkinRoutes);
  customer.route('/', inviteRoutes);
  customer.route('/', joinRoutes);
  app.route('/api', customer);

  // 管理画面向け API(ログインのセッションで認証)。ログインだけは認証の前に置く
  app.route('/admin/api', authRoutes);
  const admin = new Hono<AppEnv>();
  admin.use('*', requireStaff);
  app.route('/admin/api', admin);

  app.all('/api/*', (c) =>
    c.json<ErrorBody>({ error: { code: 'not_found', message: 'その操作は見つかりませんでした。画面を読み込み直してください。' } }, 404),
  );
  app.all('/admin/api/*', (c) =>
    c.json<ErrorBody>({ error: { code: 'not_found', message: 'その操作は見つかりませんでした。画面を読み込み直してください。' } }, 404),
  );

  // 画面(SPA)。ファイルが見つからなかったパスは、各アプリの index.html を返す。
  app.get('/', (c) => c.redirect('/liff/'));
  app.get('/liff/*', (c) => serveSpa(c.env.ASSETS, c.req.url, '/liff/index.html'));
  app.get('/admin/*', (c) => serveSpa(c.env.ASSETS, c.req.url, '/admin/index.html'));
  app.get('/admin', (c) => c.redirect('/admin/'));
  app.get('/liff', (c) => c.redirect('/liff/'));

  return app;
}

async function serveSpa(assets: Fetcher, requestUrl: string, indexPath: string): Promise<Response> {
  const url = new URL(indexPath, requestUrl);
  const res = await assets.fetch(new Request(url.toString()));
  return new Response(res.body, {
    status: res.ok ? 200 : res.status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
