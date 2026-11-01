// 会員証のスタンプを開いたときに「ポポポン」と押していく順番と時間(docs/design.md 11.6)。
// 画面から切り離した計算だけを置き、Vitest で確かめる。

/** 動きの長さ(ms) */
export const STAMP_TIMING = {
  /** 会員証が出てから、1 つ目を押し始めるまで */
  start: 60,
  /** 1 つの押す動きの長さ(上から少し大きく → ポンと押し付ける → 戻る) */
  duration: 240,
  /** 押し付けた瞬間(動きの中の割合) */
  press: 0.55,
  /** 次を押し始めるまでのずれ(この範囲で、全部が budget に収まるように決める) */
  staggerMax: 80,
  staggerMin: 30,
  /** 新しく付いた 1 個は、ほかより少し遅れて押す */
  freshGap: 90,
  /** 新しく付いた 1 個の動き(大きめに「ポン」) */
  freshDuration: 320,
  freshPress: 0.5,
  /** 押し始めから、全部が終わるまでの上限 */
  budget: 1000,
} as const;

export type StampPlan = {
  /** 押していく動きを付けるか(付けないときは、最初から押された形で出す) */
  play: boolean;
  /** 位置 → 押し始める時刻(ms)。新しく付いた 1 個は含めない */
  delays: Map<number, number>;
  /** 1 つ押すごとのずれ(ms) */
  stagger: number;
  /** 新しく付いた 1 個の位置(なければ null) */
  fresh: number | null;
  /** 新しく付いた 1 個を押し始める時刻(ms) */
  freshDelay: number | null;
  /** 新しく付いた 1 個を押し付けた瞬間(にじみ・カードが沈む・震える)(ms) */
  pressAt: number | null;
  /** 骨(無料券 1 枚分の最後)を押し付けた瞬間(ms)。骨を押さないときは null */
  boneAt: number | null;
  /** 全部が終わる時刻(ms) */
  end: number;
};

/**
 * スタンプを押していく計画を立てる。
 * - on: たまっている位置(左上から順に。2 段目も続けて数える)
 * - fresh: 前回見たときから増えた 1 個(なければ null)。ほかより少し遅れて、大きめに押す
 * - bone: 骨の位置(1 段目の最後)
 * - play: false なら動かさない(動きを減らす設定・同じ日に同じ数で開き直したとき)
 */
export function planStamps({
  on,
  fresh,
  bone,
  play,
}: {
  on: number[];
  fresh: number | null;
  bone: number;
  play: boolean;
}): StampPlan {
  const T = STAMP_TIMING;
  const delays = new Map<number, number>();
  if (!play || on.length === 0) {
    return { play: false, delays, stagger: 0, fresh, freshDelay: null, pressAt: null, boneAt: null, end: 0 };
  }
  const hasFresh = fresh !== null && on.includes(fresh);
  const regular = on.filter((i) => !(hasFresh && i === fresh));
  // 全部が budget に収まるずれ。最後の 1 つ(新しく付いた 1 個があればそれ)が終わる時刻から逆算する
  const tail = hasFresh ? T.freshGap + T.freshDuration : T.duration;
  const room = T.budget - tail;
  const raw = regular.length > 1 ? room / (regular.length - 1) : T.staggerMax;
  const stagger = Math.max(T.staggerMin, Math.min(T.staggerMax, Math.floor(raw)));
  regular.forEach((i, n) => delays.set(i, T.start + n * stagger));
  const lastRegular = regular.length > 0 ? T.start + (regular.length - 1) * stagger : null;

  let freshDelay: number | null = null;
  let pressAt: number | null = null;
  if (hasFresh) {
    freshDelay = lastRegular === null ? T.start : lastRegular + T.freshGap;
    pressAt = Math.round(freshDelay + T.freshDuration * T.freshPress);
  }
  let boneAt: number | null = null;
  if (on.includes(bone)) {
    if (hasFresh && fresh === bone) boneAt = pressAt;
    else boneAt = Math.round(delays.get(bone)! + T.duration * T.press);
  }
  const end = Math.max(
    lastRegular === null ? 0 : lastRegular + T.duration,
    freshDelay === null ? 0 : freshDelay + T.freshDuration,
  );
  return { play: true, delays, stagger, fresh: hasFresh ? fresh : null, freshDelay, pressAt, boneAt, end };
}

/**
 * 同じ日に同じ数で開き直したときは、もう「ポポポン」しない(1 日 1 回)。
 * memo は前回押した「日付:数」。読めなければ(null)毎回押す。
 */
export function shouldPlay({ memo, today, points, fresh }: { memo: string | null; today: string; points: number; fresh: boolean }) {
  if (points <= 0) return false;
  if (fresh) return true;
  return memo !== `${today}:${points}`;
}
