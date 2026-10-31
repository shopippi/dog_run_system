import { RUNNABLE_JOBS, type JobRunResult, type RunnableJob, type SystemStatusResponse } from '@dr/shared';
import { Hono, type Context } from 'hono';
import { runBackupJob, runDailyStatsJob, runHolidaysJob, runPostalAreasJob, runWeatherJob } from '../../cron';
import type { AppEnv } from '../../env';
import { requireRole } from '../../lib/staff-auth';
import { auditStatement } from '../../services/audit';
import { errors } from '../../lib/errors';
import { loadSettings } from '../../lib/settings';
import { systemStatus } from '../../services/system-status';

// A-17・D-02 システムの状態、B-02 祝日データの手動取り込み
export const systemRoutes = new Hono<AppEnv>();

/** 手動で動かした自動処理を、操作ログにも残す(誰がいつ動かしたか) */
async function auditJob(c: Context<AppEnv>, action: string, result: JobRunResult) {
  const staff = c.get('staff');
  await auditStatement(c.env.DB, {
    staffId: staff.id,
    action,
    targetType: 'system',
    targetId: action,
    after: result,
    now: c.get('now'),
  }).run();
}

// 祝日データの手動取り込み(B-02)。管理者
systemRoutes.post('/holidays/import', requireRole('admin'), async (c) => {
  const result: JobRunResult = await runHolidaysJob(c.env, c.get('now'));
  await auditJob(c, 'system.holidays_import', result);
  return c.json(result);
});

// バックアップの手動実行(B-04)。管理者
systemRoutes.post('/system/backup', requireRole('admin'), async (c) => {
  const result: JobRunResult = await runBackupJob(c.env, c.get('now'));
  await auditJob(c, 'system.backup', result);
  return c.json(result);
});

// システムの状態(A-17 簡易・D-02 詳細)。管理者は簡易、製作者は詳細(エラーの記録・実行の履歴・データ量)。受付スタッフは見られない
systemRoutes.get('/system-status', requireRole('admin'), async (c) => {
  const staff = c.get('staff');
  const settings = await loadSettings(c.env.DB);
  const body: SystemStatusResponse = await systemStatus(c.env.DB, c.get('now'), {
    detail: staff.role === 'developer',
    contact: settings.developer_contact,
    lineLimit: settings.booking_notify.monthly_limit,
    lineConfigured: !!c.env.LINE_MESSAGING_TOKEN?.trim(),
  });
  return c.json(body);
});

const RUNNERS: Record<RunnableJob, (env: AppEnv['Bindings'], now: Date) => Promise<JobRunResult>> = {
  weather: (env, now) => runWeatherJob(env, now),
  holidays: runHolidaysJob,
  backup: runBackupJob,
  daily_stats: runDailyStatsJob,
  postal_areas: runPostalAreasJob,
};

// 自動処理を今すぐ実行する(M-17 の「今すぐ実行」)。管理者
systemRoutes.post('/system/run/:job', requireRole('admin'), async (c) => {
  const job = c.req.param('job') as RunnableJob;
  if (!(RUNNABLE_JOBS as readonly string[]).includes(job)) {
    throw errors.notFound('その処理は、ここからは動かせません。画面を読み込み直してください。');
  }
  const result = await RUNNERS[job](c.env, c.get('now'));
  await auditJob(c, `system.run.${job}`, result);
  return c.json(result);
});
