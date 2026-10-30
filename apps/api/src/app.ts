import { Hono } from 'hono';
import type { AppEnv } from './env';
import { AppError, type ErrorBody } from './lib/errors';
import { nowMiddleware, requireLineUser } from './lib/middleware';
import { idempotency } from './lib/idempotency';
import { customerBodyLimit, gzipJson, isTransientDbError, privateRevalidate } from './lib/http';
import { checkinRoutes } from './routes/customer/checkins';
import { dogRoutes } from './routes/customer/dogs';
import { inviteRoutes } from './routes/customer/invites';
import { joinRoutes } from './routes/customer/join';
import { meRoutes } from './routes/customer/me';
import { authRoutes } from './routes/admin/auth';
import { todayRoutes } from './routes/admin/today';
import { householdRoutes } from './routes/admin/households';
import { adminCheckinRoutes } from './routes/admin/checkins';
import { requireStaff } from './lib/staff-auth';
import { mediaRoutes } from './routes/customer/media';
import { surveyRoutes } from './routes/customer/survey';
import { householdDetailRoutes } from './routes/admin/household-detail';
import { mergesRoutes } from './routes/admin/merges';
import { requestsRoutes } from './routes/admin/requests';
import { eventsRoutes } from './routes/admin/events';
import { surveyQuestionsRoutes } from './routes/admin/survey-questions';
import { breedsRoutes } from './routes/admin/breeds';
import { settingsRoutes } from './routes/admin/settings';
import { staffRoutes } from './routes/admin/staff';
import { auditRoutes } from './routes/admin/audit';
import { exportRoutes } from './routes/admin/export';
import { dashboardRoutes } from './routes/admin/dashboard';
import { systemRoutes } from './routes/admin/system';
import { historyRoutes } from './routes/customer/history';
import { profileRoutes } from './routes/customer/profile';
import { familyRoutes } from './routes/customer/family';
import { ticketRoutes } from './routes/customer/tickets';
import { adminTicketRoutes } from './routes/admin/tickets';
import { migrationRoutes } from './routes/admin/migrations';
import { cardBackgroundRoutes } from './routes/customer/card-background';
import { facilityHandler } from './routes/facility';

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use('*', nowMiddleware);
  // API の JSON を圧縮する(電波が弱い場所でも少ない通信で済むように。1KB 未満と写真は圧縮しない)
  app.use('/api/*', gzipJson);

  app.onError((err, c) => {
    if (err instanceof AppError) {
      const body: ErrorBody = { error: { code: err.code, message: err.message, details: err.details } };
      return c.json(body, err.status);
    }
    console.error(err);
    // データベースの一時的な不調(混雑・接続の切れなど)は 503 にする。画面は少し待って、同じ送信の印で送り直す
    if (isTransientDbError(err)) {
      const body: ErrorBody = {
        error: {
          code: 'temporarily_unavailable',
          message: '混み合っているため、うまく処理できませんでした。少し待ってから、もう一度お試しください。',
        },
      };
      c.header('retry-after', '2');
      return c.json(body, 503);
    }
    const body: ErrorBody = {
      error: {
        code: 'internal',
        message: 'うまく処理できませんでした。少し待ってから、もう一度お試しください。続くときは管理者に知らせてください。',
      },
    };
    return c.json(body, 500);
  });

  app.get('/api/health', (c) => c.json({ ok: true }));
  // 施設の名前(認証なし。ログインの前の画面でも使う)
  app.get('/api/public-settings', privateRevalidate, facilityHandler);
  app.get('/admin/api/public-settings', facilityHandler);

  // お客さん向け API(LINE の IDトークンで認証)
  const customer = new Hono<AppEnv>();
  // 送られる内容の大きさの上限(写真は 4MB、それ以外は 64KB)。ログインの確認より前に断る
  customer.use('*', customerBodyLimit);
  customer.use('*', requireLineUser);
  // 読み込み(GET)は ETag をつけ、変わっていなければ 304(中身を送らない)
  customer.use('*', privateRevalidate);
  // 変更の送信は、送信の印(Idempotency-Key)で二重に処理しない(要件定義書 15.3)
  customer.use('*', idempotency);
  customer.route('/', meRoutes);
  customer.route('/', dogRoutes);
  customer.route('/', mediaRoutes);
  customer.route('/', surveyRoutes);
  customer.route('/', checkinRoutes);
  customer.route('/', inviteRoutes);
  customer.route('/', joinRoutes);
  customer.route('/', historyRoutes);
  customer.route('/', profileRoutes);
  customer.route('/', familyRoutes);
  customer.route('/', ticketRoutes);
  customer.route('/', cardBackgroundRoutes);
  app.route('/api', customer);

  // 管理画面向け API(ログインのセッションで認証)。ログインだけは認証の前に置く
  app.route('/admin/api', authRoutes);
  const admin = new Hono<AppEnv>();
  admin.use('*', requireStaff);
  admin.route('/', todayRoutes);
  admin.route('/', adminCheckinRoutes);
  admin.route('/', householdRoutes);
  admin.route('/', householdDetailRoutes);
  admin.route('/', mergesRoutes);
  admin.route('/', requestsRoutes);
  admin.route('/', eventsRoutes);
  admin.route('/', surveyQuestionsRoutes);
  admin.route('/', breedsRoutes);
  admin.route('/', settingsRoutes);
  admin.route('/', staffRoutes);
  admin.route('/', auditRoutes);
  admin.route('/', exportRoutes);
  admin.route('/', dashboardRoutes);
  admin.route('/', systemRoutes);
  admin.route('/', adminTicketRoutes);
  admin.route('/', migrationRoutes);
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
