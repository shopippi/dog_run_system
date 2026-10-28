import { toJstIso, type SystemJobName } from '@dr/shared';

/**
 * 自動処理の結果。message は管理画面にそのまま出す日本語(何件できたか・何が起きたか)。
 * detail は元の例外の文など、製作者が調べるための内容(英語のこともある。管理画面の「状態」には出さない)
 */
export type JobOutcome = { status?: 'ok' | 'warning' | 'failed'; message: string; detail?: string };

/** 自動処理の失敗。message は画面に出す日本語、detail は元の例外の文 */
export class JobError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'JobError';
  }
}

/** 例外の文(英語のこともある)を detail 用に取り出す */
export const errorText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);

/** 失敗の理由が分からないときに出す文 */
export const JOB_FAILED_MESSAGE = 'うまく実行できませんでした。次の実行で自動でやり直します。続くときは製作者に連絡してください。';

/**
 * system_jobs.message には、画面に出す文と detail を区切って入れる(列を増やさないため)。
 * 読むときは splitJobMessage で分ける
 */
const DETAIL_MARK = '\n[詳細] ';
export function joinJobMessage(message: string, detail?: string | null): string {
  return detail ? `${message}${DETAIL_MARK}${detail.slice(0, 500)}` : message;
}
export function splitJobMessage(text: string | null): { message: string | null; detail: string | null } {
  if (text === null) return { message: null, detail: null };
  const i = text.indexOf(DETAIL_MARK);
  return i < 0 ? { message: text, detail: null } : { message: text.slice(0, i), detail: text.slice(i + DETAIL_MARK.length) };
}

/**
 * 自動処理を1回実行し、結果を system_jobs に残す(A-17・D-02 で表示する)。
 * 処理の中で例外が出ても外には投げず、「失敗」として記録する(ほかの自動処理は続ける)。
 */
export async function runJob(
  db: D1Database,
  name: SystemJobName,
  now: Date,
  fn: () => Promise<JobOutcome>,
): Promise<{ status: 'ok' | 'warning' | 'failed'; message: string; detail?: string }> {
  const startedAt = Date.now();
  const inserted = await db
    .prepare("INSERT INTO system_jobs (name, started_at, status) VALUES (?, ?, 'running')")
    .bind(name, toJstIso(now))
    .run();
  const id = inserted.meta.last_row_id;
  let status: 'ok' | 'warning' | 'failed';
  let message: string;
  let detail: string | undefined;
  try {
    const out = await fn();
    status = out.status ?? 'ok';
    message = out.message;
    detail = out.detail;
  } catch (e) {
    console.error(`[job ${name}]`, e);
    status = 'failed';
    // 画面には日本語だけを出し、元の例外の文は detail に分ける
    if (e instanceof JobError) {
      message = e.message;
      detail = e.detail;
    } else {
      message = JOB_FAILED_MESSAGE;
      detail = errorText(e);
    }
  }
  const finished = new Date(now.getTime() + (Date.now() - startedAt));
  await db
    .prepare('UPDATE system_jobs SET finished_at = ?, status = ?, message = ? WHERE id = ?')
    .bind(toJstIso(finished), status, joinJobMessage(message, detail), id)
    .run();
  return detail ? { status, message, detail } : { status, message };
}

/** その処理の最後の成功(ok または warning)の日時 */
export async function lastSuccess(db: D1Database, name: SystemJobName): Promise<string | null> {
  const row = await db
    .prepare("SELECT MAX(started_at) AS at FROM system_jobs WHERE name = ? AND status IN ('ok', 'warning')")
    .bind(name)
    .first<{ at: string | null }>();
  return row?.at ?? null;
}
