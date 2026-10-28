import type { Bindings } from './env';

/**
 * 自動処理(要件定義書 9.5、12.3)。
 * 毎日 3:10(日本時間): 日別集計の再計算、有効期限の処理、バックアップ、移行期間終了後の画像削除(B-03〜B-06)
 * 毎日 5:10(日本時間): 前日の天気の取得(B-01)
 * 毎年 2月1日: 翌年の祝日の取り込み(B-02)
 */
export async function runScheduled(_cron: string, _env: Bindings, _now: Date): Promise<void> {
  // フェーズ3で実装する
}
