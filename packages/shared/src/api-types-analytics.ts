// API の応答の型(analytics: 分析と自動処理)

/** 自動処理の種類(system_jobs.name)。要件定義書 9.5 */
export const SYSTEM_JOB_NAMES = ['weather', 'holidays', 'daily_stats', 'backup', 'expiry', 'migration_images'] as const;
export type SystemJobName = (typeof SYSTEM_JOB_NAMES)[number];
export const SYSTEM_JOB_LABELS: Record<SystemJobName, string> = {
  weather: '天気の取得',
  holidays: '祝日の取り込み',
  daily_stats: '日別の集計',
  backup: 'バックアップ',
  expiry: '有効期限の処理',
  migration_images: '引き継ぎ申請の写真の削除',
};

/** 1回の実行の結果。warning は「一部だけできた」 */
export type SystemJobStatus = 'running' | 'ok' | 'warning' | 'failed';

/** 自動処理を手動で動かしたときの結果(POST /admin/api/holidays/import など) */
export type JobRunResult = { status: 'ok' | 'warning' | 'failed'; message: string };
