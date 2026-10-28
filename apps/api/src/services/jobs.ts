import { toJstIso, type SystemJobName } from '@dr/shared';

/** 自動処理の結果。message は管理画面にそのまま出す(何件できたか・何が起きたか) */
export type JobOutcome = { status?: 'ok' | 'warning' | 'failed'; message: string };

/**
 * 自動処理を1回実行し、結果を system_jobs に残す(A-17・D-02 で表示する)。
 * 処理の中で例外が出ても外には投げず、「失敗」として記録する(ほかの自動処理は続ける)。
 */
export async function runJob(
  db: D1Database,
  name: SystemJobName,
  now: Date,
  fn: () => Promise<JobOutcome>,
): Promise<{ status: 'ok' | 'warning' | 'failed'; message: string }> {
  const startedAt = Date.now();
  const inserted = await db
    .prepare("INSERT INTO system_jobs (name, started_at, status) VALUES (?, ?, 'running')")
    .bind(name, toJstIso(now))
    .run();
  const id = inserted.meta.last_row_id;
  let status: 'ok' | 'warning' | 'failed';
  let message: string;
  try {
    const out = await fn();
    status = out.status ?? 'ok';
    message = out.message;
  } catch (e) {
    console.error(`[job ${name}]`, e);
    status = 'failed';
    message = `うまく実行できませんでした(${String((e as Error)?.message ?? e).slice(0, 300)})`;
  }
  const finished = new Date(now.getTime() + (Date.now() - startedAt));
  await db
    .prepare('UPDATE system_jobs SET finished_at = ?, status = ?, message = ? WHERE id = ?')
    .bind(toJstIso(finished), status, message, id)
    .run();
  return { status, message };
}

/** その処理の最後の成功(ok または warning)の日時 */
export async function lastSuccess(db: D1Database, name: SystemJobName): Promise<string | null> {
  const row = await db
    .prepare("SELECT MAX(started_at) AS at FROM system_jobs WHERE name = ? AND status IN ('ok', 'warning')")
    .bind(name)
    .first<{ at: string | null }>();
  return row?.at ?? null;
}
