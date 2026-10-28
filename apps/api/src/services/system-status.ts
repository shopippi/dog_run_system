import {
  RUNNABLE_JOBS,
  SYSTEM_JOB_LABELS,
  SYSTEM_JOB_NAMES,
  toJstIso,
  type StatusLevel,
  type SystemJobName,
  type SystemJobRun,
  type SystemStatusResponse,
} from '@dr/shared';
import { splitJobMessage } from './jobs';

// A-17・D-02 システムの状態。system_jobs の記録から、処理ごとに正常(green)・注意(yellow)・止まっている(red)を決める。

const HOUR = 3600_000;

/** 処理ごとの、正常とみなす間隔(最後の成功からこれ以内なら正常) */
const EXPECTED: Record<SystemJobName, { hours: number; schedule: string }> = {
  weather: { hours: 30, schedule: '毎朝 5:10' },
  daily_stats: { hours: 30, schedule: '毎晩 3:10(来場のたびにも更新)' },
  expiry: { hours: 30, schedule: '毎晩 3:10' },
  backup: { hours: 30, schedule: '毎晩 3:10' },
  migration_images: { hours: 30, schedule: '毎晩 3:10' },
  holidays: { hours: 400 * 24, schedule: '毎年 2月1日' },
};

/** 「動いています」のまま、これより長いものは途中で止まったとみなす */
const STUCK_MS = HOUR;

const LEVEL_ORDER: StatusLevel[] = ['green', 'yellow', 'red'];
export const worst = (levels: StatusLevel[]): StatusLevel =>
  levels.reduce<StatusLevel>((w, l) => (LEVEL_ORDER.indexOf(l) > LEVEL_ORDER.indexOf(w) ? l : w), 'green');

type Row = { name: SystemJobName; started_at: string; finished_at: string | null; status: SystemJobRun['status']; message: string | null };
const toRun = (r: Row): SystemJobRun => ({
  name: r.name,
  label: SYSTEM_JOB_LABELS[r.name] ?? r.name,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  status: r.status,
  // 画面に出すのは日本語の文だけ(元の例外の文は detail。製作者の詳細のときだけ返す)
  message: splitJobMessage(r.message).message,
});
const toRunWithDetail = (r: Row): SystemJobRun => ({ ...toRun(r), detail: splitJobMessage(r.message).detail });

/**
 * 1つの処理の色を決める。
 * - 正常(green): 最後の成功が、決まった間隔(毎日の処理は30時間)以内で、最後の実行が「失敗」でない
 * - 黄: 最後の実行が「一部だけ」、または最後の成功が間隔の2倍以内(失敗して次の実行でやり直す・予定より遅れている)、
 *       またはまだ一度も動いていない(使い始めたばかり)
 * - 赤: それ以外(しばらく成功していない)
 */
export function levelOf(
  name: SystemJobName,
  lastRun: SystemJobRun | null,
  lastSuccessAt: string | null,
  now: Date,
): { level: StatusLevel; summary: string } {
  const { hours } = EXPECTED[name];
  const age = lastSuccessAt ? now.getTime() - new Date(lastSuccessAt).getTime() : Infinity;
  const stuck = lastRun?.status === 'running' && now.getTime() - new Date(lastRun.startedAt).getTime() > STUCK_MS;
  const lastFailed = lastRun?.status === 'failed' || stuck;
  if (!lastRun) return { level: 'yellow', summary: 'まだ一度も動いていません。決まった時刻に自動で動きます。' };
  if (age <= hours * HOUR && !lastFailed) {
    if (lastRun.status === 'warning') return { level: 'yellow', summary: '一部だけできました。くわしくは結果を見てください。' };
    return { level: 'green', summary: '正常に動いています。' };
  }
  if (age <= hours * 2 * HOUR) {
    return lastFailed
      ? { level: 'yellow', summary: '前回はうまくいきませんでした。次の実行で自動でやり直します。' }
      : { level: 'yellow', summary: '予定の時刻に動いていないようです。明日も続くときは製作者に連絡してください。' };
  }
  if (!lastSuccessAt) return { level: 'red', summary: 'まだ一度もうまく動いていません。製作者に連絡してください。' };
  return { level: 'red', summary: 'しばらくうまく動いていません。製作者に連絡してください。' };
}

/** 表の名前を、画面に出す言葉にする(製作者向けの詳細。元の名前も並べて出す) */
const TABLE_LABELS: Record<string, string> = {
  households: 'おうち',
  family_members: '家族',
  invites: '家族の招待',
  dogs: '犬',
  dog_changes: '犬の変更履歴',
  breeds: '犬種の選択肢',
  visits: '来場',
  visit_dogs: '来場した犬',
  point_ledger: 'ポイントの台帳',
  tickets: '無料券',
  merges: 'おうちの統合',
  requests: '確認待ち',
  survey_questions: 'アンケートの質問',
  survey_answers: 'アンケートの回答',
  daily_stats: '日別の集計',
  daily_weather: '日別の天気',
  calendar: '日付の属性',
  events: 'イベント',
  settings: '設定',
  staff_users: '管理画面の利用者',
  staff_sessions: 'ログイン状態',
  audit_log: '操作ログ',
  system_jobs: '自動処理の記録',
  d1_migrations: '記録の形の版',
};

/** 写真1枚の大きさの見込み(6.2) */
export const PHOTO_BYTES = 150 * 1024;
/** R2 の無料枠 */
export const R2_FREE_BYTES = 10 * 1024 ** 3;
/** D1 の1データベースの上限(無料プラン) */
export const D1_DB_LIMIT_BYTES = 500 * 1024 ** 2;

export async function systemStatus(
  db: D1Database,
  now: Date,
  opts: { detail: boolean; contact: string },
): Promise<SystemStatusResponse> {
  const [lastRes, successRes] = await db.batch([
    db.prepare(
      `SELECT j.name, j.started_at, j.finished_at, j.status, j.message FROM system_jobs j
        WHERE j.id = (SELECT id FROM system_jobs k WHERE k.name = j.name ORDER BY k.started_at DESC, k.id DESC LIMIT 1)`,
    ),
    db.prepare("SELECT name, MAX(started_at) AS at FROM system_jobs WHERE status IN ('ok', 'warning') GROUP BY name"),
  ]);
  const last = new Map((lastRes!.results as Row[]).map((r) => [r.name, toRun(r)]));
  const success = new Map((successRes!.results as { name: SystemJobName; at: string }[]).map((r) => [r.name, r.at]));

  const jobs = SYSTEM_JOB_NAMES.map((name) => {
    const lastRun = last.get(name) ?? null;
    const lastSuccessAt = success.get(name) ?? null;
    const { level, summary } = levelOf(name, lastRun, lastSuccessAt, now);
    return {
      name,
      label: SYSTEM_JOB_LABELS[name],
      level,
      summary,
      schedule: EXPECTED[name].schedule,
      lastRun,
      lastSuccessAt,
      runnable: (RUNNABLE_JOBS as readonly string[]).includes(name),
    };
  });
  const overall = worst(jobs.map((j) => j.level));

  let detail: SystemStatusResponse['detail'] = null;
  if (opts.detail) {
    const { results: tables } = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")
      .all<{ name: string }>();
    const counts = await db.batch([
      ...tables.map((t) => db.prepare(`SELECT COUNT(*) AS n FROM "${t.name.replaceAll('"', '""')}"`)),
      db.prepare(
        `SELECT (SELECT COUNT(*) FROM dogs WHERE photo_key IS NOT NULL)
              + (SELECT COUNT(*) FROM requests WHERE attachment_key IS NOT NULL AND attachment_deleted_at IS NULL) AS n`,
      ),
      db.prepare(
        `SELECT name, started_at, finished_at, status, message FROM system_jobs WHERE status = 'failed'
          ORDER BY started_at DESC, id DESC LIMIT 10`,
      ),
      db.prepare('SELECT name, started_at, finished_at, status, message FROM system_jobs ORDER BY started_at DESC, id DESC LIMIT 30'),
    ]);
    const photoCount = (counts[tables.length]!.results[0] as { n: number }).n;
    const sizeAfter = (counts[0]?.meta as { size_after?: number } | undefined)?.size_after;
    detail = {
      recentFailures: (counts[tables.length + 1]!.results as Row[]).map(toRunWithDetail),
      history: (counts[tables.length + 2]!.results as Row[]).map(toRunWithDetail),
      tables: tables.map((t, i) => ({
        name: t.name,
        label: TABLE_LABELS[t.name] ?? t.name,
        rows: (counts[i]!.results[0] as { n: number }).n,
      })),
      databaseBytes: typeof sizeAfter === 'number' && sizeAfter > 0 ? sizeAfter : null,
      databaseLimitBytes: D1_DB_LIMIT_BYTES,
      photos: { count: photoCount, estimatedBytes: photoCount * PHOTO_BYTES, limitBytes: R2_FREE_BYTES },
    };
  }

  return {
    checkedAt: toJstIso(now),
    overall,
    jobs,
    contact: overall === 'red' ? opts.contact || null : null,
    detail,
  };
}
