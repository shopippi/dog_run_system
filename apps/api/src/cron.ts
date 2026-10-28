import { toJstIso } from '@dr/shared';
import type { Bindings } from './env';
import { recheckDailyStats } from './services/daily-stats';
import { importHolidays, shouldImportHolidays } from './services/holidays';
import { runJob } from './services/jobs';
import { loadSettings } from './lib/settings';
import { fetchWeather, type WeatherSource } from './services/weather';
import { backupDatabase } from './services/backup';
import { expirePointsAndTickets } from './services/expiry';

/** 日本時間 3:10(UTC 18:10)。日別集計の再計算、有効期限の処理、バックアップ、移行期間終了後の画像削除 */
export const CRON_NIGHTLY = '10 18 * * *';
/** 日本時間 5:10(UTC 20:10)。前日の天気の取得 */
export const CRON_MORNING = '10 20 * * *';

/**
 * 自動処理(要件定義書 9.5、12.3)。wrangler.toml の crons の文字列ごとに処理を分ける。
 * 毎日 3:10(日本時間): 日別集計の再計算、有効期限の処理、バックアップ、移行期間終了後の画像削除(B-03〜B-06)
 * 毎日 5:10(日本時間): 前日の天気の取得(B-01)
 * 毎年 2月1日: 翌年の祝日の取り込み(B-02。3:10 の処理の中で行う)
 * 処理ごとに結果を system_jobs に残す。1つが失敗しても、ほかの処理は続ける。
 */
export async function runScheduled(cron: string, env: Bindings, now: Date): Promise<void> {
  const kind = cron === CRON_MORNING ? 'morning' : cron === CRON_NIGHTLY ? 'nightly' : guessKind(now);
  if (kind === 'nightly') await runNightly(env, now);
  else await runMorning(env, now);
}

/** 知らない cron の文字列のときは、日本時間の時刻で決める(4時より前は夜の処理) */
function guessKind(now: Date): 'nightly' | 'morning' {
  return Number(toJstIso(now).slice(11, 13)) < 4 ? 'nightly' : 'morning';
}

export async function runNightly(env: Bindings, now: Date): Promise<void> {
  await runDailyStatsJob(env, now);
  await runExpiryJob(env, now);
  await runBackupJob(env, now);
  if (await shouldImportHolidays(env.DB, now)) await runHolidaysJob(env, now);
}

export async function runMorning(env: Bindings, now: Date): Promise<void> {
  await runWeatherJob(env, now);
}

/** B-03 日別集計の再計算(手動の「今すぐ実行」からも呼ぶ) */
export function runDailyStatsJob(env: Bindings, now: Date) {
  return runJob(env.DB, 'daily_stats', now, async () => {
    const { from, to } = await recheckDailyStats(env.DB, now);
    return { message: `${from}〜${to} の日別の集計を作り直しました。` };
  });
}

/** B-02 祝日の取り込み(毎年2月1日と、管理画面の手動の取り込みから呼ぶ) */
export function runHolidaysJob(env: Bindings, now: Date) {
  return runJob(env.DB, 'holidays', now, () => importHolidays(env.DB, now));
}

/** B-01 前日の天気の取得(毎朝 5:10 と、管理画面の「今すぐ実行」から呼ぶ) */
export function runWeatherJob(env: Bindings, now: Date, source?: WeatherSource) {
  return runJob(env.DB, 'weather', now, async () => {
    const settings = await loadSettings(env.DB);
    return fetchWeather(env.DB, now, settings.weather_station, source);
  });
}

/** B-04 バックアップ(毎晩 3:10 と、管理画面の手動の実行から呼ぶ) */
export function runBackupJob(env: Bindings, now: Date) {
  return runJob(env.DB, 'backup', now, () => backupDatabase(env.DB, env.MEDIA, now));
}

/** B-05 有効期限の処理(毎晩 3:10) */
export function runExpiryJob(env: Bindings, now: Date) {
  return runJob(env.DB, 'expiry', now, async () => expirePointsAndTickets(env.DB, now, await loadSettings(env.DB)));
}
