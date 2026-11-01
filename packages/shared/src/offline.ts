import { toJstDate } from './date';

// 電波が弱い場所でも、チェックインなどの送信がなくならず、二重にもならないための決まり(要件定義書 15.3)。
// 画面(apps/liff)と API(apps/api)で同じ値を使う。

/** 同じ送信の印(Idempotency-Key ヘッダー)。画面が送るたびに作る UUID。英数字とハイフンの 8〜64 文字 */
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9-]{8,64}$/;

/** 送信の印の記録を残す日数(少なくとも1日。これより古い記録は、夜間の処理で消す。業務の記録ではないため) */
export const IDEMPOTENCY_RETENTION_DAYS = 7;

/**
 * 「確定」を押した時刻を、どこまでさかのぼって信じるか(分)。
 * 電波が弱くて送信が遅れたときだけ、押した時刻をチェックインの時刻にする。
 */
export const CLIENT_TIME_WINDOW_MINUTES = 30;

export type CheckinTimeDecision = {
  /** チェックインの日時として使う時刻 */
  at: Date;
  /** client: 押した時刻を使った。server: サーバーの時刻を使った */
  source: 'client' | 'server';
};

/**
 * チェックインの時刻を決める(要件定義書 15.3「押した時刻の扱い」)。
 *
 * スマホの時計は狂っていることがあるため、押した時刻そのものは信じない。スマホが送るのは
 * 「押した時刻(pressedAt)」と「送った時刻(clientNow)」の2つで、どちらもスマホの同じ時計で測る。
 * その差(押してから送るまでの時間)だけを使い、サーバーの時刻からさかのぼる。時計がずれていても差は正しい。
 *
 * 次のどれかに当てはまるときは、サーバーの時刻を使う:
 * - 値がない・数でない
 * - 差がマイナス(時計を戻した)か、30分より長い
 * - さかのぼると、日本時間で前の日になる(ポイントの日付はサーバーの「今日」から動かさない)
 *
 * 差は最大 30 分で、同じ日の中だけ。ずらせるのはチェックインの時刻だけで、日付・ポイントは変わらない。
 */
export function resolveCheckinTime(args: {
  serverNow: Date;
  pressedAt?: number | null;
  clientNow?: number | null;
}): CheckinTimeDecision {
  const { serverNow, pressedAt, clientNow } = args;
  const server: CheckinTimeDecision = { at: serverNow, source: 'server' };
  if (typeof pressedAt !== 'number' || typeof clientNow !== 'number') return server;
  if (!Number.isFinite(pressedAt) || !Number.isFinite(clientNow)) return server;
  const elapsed = clientNow - pressedAt;
  if (elapsed < 0 || elapsed > CLIENT_TIME_WINDOW_MINUTES * 60_000) return server;
  // 1秒未満の差は、そのままサーバーの時刻にする(ふつうに送れたとき)
  if (elapsed < 1000) return server;
  const at = new Date(serverNow.getTime() - elapsed);
  if (toJstDate(at) !== toJstDate(serverNow)) return server;
  return { at, source: 'client' };
}
