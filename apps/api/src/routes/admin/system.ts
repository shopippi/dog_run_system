import type { JobRunResult } from '@dr/shared';
import { Hono, type Context } from 'hono';
import { runHolidaysJob } from '../../cron';
import type { AppEnv } from '../../env';
import { requireRole } from '../../lib/staff-auth';
import { auditStatement } from '../../services/audit';

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
