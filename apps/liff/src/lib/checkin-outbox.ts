import { toJstDate, type CheckinResult } from '@dr/shared';
import { ApiError, backoffMs, isRetryable, postJson, sleep, waitForOnline } from './api';
import { currentUserKey } from './liff';
import { newId, readJson, removeKey, writeJson } from './storage';

// 送信を待っているチェックイン(要件定義書 15.3)。電波が弱くて届かなかったときも、なくさずに送り続ける。
//
// - 「チェックインする」を押したとき、送る内容と送信の印(UUID)と押した時刻を端末に保存してから送る
// - 届かなければ、つながるまで待って同じ印で送り直す。サーバーは同じ印を1回だけ処理するので、二重にならない
// - 画面を閉じても、次に開いたときに続きから送る(同じ日のうちだけ。日付が変わったら送らずに捨てる)
// - 完了の画面は、サーバーが受け付けたあとにだけ出す
// - LINE のログインをやり直すために画面が読み込み直されても、保存してあるので続きから送れる

const KEY = 'dr.outbox.checkin.v1';

export type PendingCheckin = {
  /** 送信の印 */
  key: string;
  /** LINE のユーザー(ハッシュ)。ほかの人の送信待ちは送らない */
  user: string;
  passphrase: string;
  dogIds: number[];
  /** 押した時刻(スマホの時計) */
  pressedAt: number;
  /** 押した日(日本時間・スマホの時計) */
  day: string;
};

export type OutboxStatus =
  | { kind: 'idle' }
  | { kind: 'sending'; pending: PendingCheckin }
  | { kind: 'waiting'; pending: PendingCheckin; offline: boolean }
  | { kind: 'done'; pending: PendingCheckin; result: CheckinResult }
  | { kind: 'failed'; pending: PendingCheckin; error: unknown };

let status: OutboxStatus = { kind: 'idle' };
/** いま送っている流れの番号。やめたとき・新しく押したときに変え、古い流れの結果は使わない */
let generation = 0;
let running = false;
let wake: (() => void) | null = null;
const listeners = new Set<(s: OutboxStatus) => void>();

function setStatus(next: OutboxStatus) {
  status = next;
  for (const l of listeners) l(next);
}

export function outboxStatus(): OutboxStatus {
  return status;
}

export function subscribeOutbox(listener: (s: OutboxStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function loadPending(): PendingCheckin | null {
  const p = readJson<PendingCheckin>(KEY);
  if (!p || typeof p.key !== 'string' || !Array.isArray(p.dogIds) || typeof p.pressedAt !== 'number') return null;
  return p;
}

/** 完了・失敗を画面に伝えたあと、次の送信に備えて元に戻す */
export function acknowledgeOutbox(): void {
  if (status.kind === 'done' || status.kind === 'failed') setStatus({ kind: 'idle' });
}

/** 「チェックインする」を押したとき。保存してから送る */
export function enqueueCheckin(input: { passphrase: string; dogIds: number[] }): PendingCheckin | null {
  const user = currentUserKey();
  if (!user) return null;
  const pressedAt = Date.now();
  const pending: PendingCheckin = {
    key: newId(),
    user,
    passphrase: input.passphrase,
    dogIds: input.dogIds,
    pressedAt,
    day: toJstDate(new Date(pressedAt)),
  };
  // 前の送信待ちがあれば、新しく押した方に置き換える
  if (running) {
    generation += 1;
    running = false;
    wake?.();
  }
  // 保存できない端末でも、開いているあいだは送り続ける
  writeJson(KEY, pending);
  void run(pending);
  return pending;
}

/** 開いたとき。前に送れなかったチェックインがあれば、続きから送る(同じ人・同じ日だけ) */
export function resumeOutbox(): void {
  if (running) return;
  const pending = loadPending();
  if (!pending) return;
  if (pending.user !== currentUserKey()) return;
  if (pending.day !== toJstDate(new Date())) {
    // 前の日に押したチェックインは送らない(今日のチェックインにしてしまわないように)
    removeKey(KEY);
    return;
  }
  void run(pending);
}

/** 待っているあいだに「今すぐ送る」を押したとき */
export function retryNow(): void {
  wake?.();
}

/** 送るのをやめる(押し間違えたときなど) */
export function cancelPending(): void {
  removeKey(KEY);
  generation += 1;
  running = false;
  wake?.();
  setStatus({ kind: 'idle' });
}

function waitBeforeRetry(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener('online', done);
      window.clearTimeout(t);
      wake = null;
      resolve();
    };
    const t = window.setTimeout(done, ms);
    window.addEventListener('online', done);
    wake = done;
  });
}

async function run(pending: PendingCheckin): Promise<void> {
  if (running) return;
  running = true;
  const gen = ++generation;
  const alive = () => gen === generation;
  let attempt = 0;
  /** 一度でも待ったか(待ったあとは、送っているあいだも「送信を待っています」のまま出す) */
  let waited = false;
  try {
    while (alive()) {
      attempt += 1;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        waited = true;
        setStatus({ kind: 'waiting', pending, offline: true });
        await waitBeforeRetry(30_000);
        if (!alive()) return;
        await waitForOnline(0);
      }
      setStatus(!waited ? { kind: 'sending', pending } : { kind: 'waiting', pending, offline: false });
      try {
        const result = await postJson<CheckinResult>(
          '/api/checkins',
          { passphrase: pending.passphrase, dogIds: pending.dogIds, pressedAt: pending.pressedAt },
          // 送り直しはこの中でも行う(短い間隔で2回)。それでも届かなければ、下で間を空けて続ける
          { idempotencyKey: pending.key, attempts: 2, timeoutMs: 15_000 },
        );
        if (!alive()) return;
        removeKey(KEY);
        setStatus({ kind: 'done', pending, result });
        return;
      } catch (e) {
        if (!alive()) return;
        if (!isRetryable(e)) {
          removeKey(KEY);
          setStatus({ kind: 'failed', pending, error: e });
          return;
        }
        // 日付が変わったら送らない
        if (pending.day !== toJstDate(new Date())) {
          removeKey(KEY);
          setStatus({
            kind: 'failed',
            pending,
            error: new ApiError(0, 'expired', '日付が変わったため、送るのをやめました。受付のQRコードを読み取って、もう一度チェックインしてください。'),
          });
          return;
        }
        waited = true;
        setStatus({ kind: 'waiting', pending, offline: e instanceof ApiError && e.status === 0 });
        await sleep(0);
        await waitBeforeRetry(Math.min(backoffMs(attempt + 1) * 2, 20_000));
      }
    }
  } finally {
    if (alive()) running = false;
  }
}
