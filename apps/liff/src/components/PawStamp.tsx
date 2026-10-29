import { todayStampIndices, toJstDate } from '@dr/shared';
import { m } from 'motion/react';
import { useEffect, useState, type CSSProperties } from 'react';
import { tapticPon } from '../lib/motion';
import { STAMP_TIMING as T, planStamps, shouldPlay, type StampPlan } from '../lib/stamp-plan';

// 会員証のスタンプ(docs/design.md 5章「スタンプ」・11.6)。肉球の塗りの SVG と、10 個目の骨の SVG。
// たまった分は押した跡らしく、1つずつ少し傾け、濃さを変える(index から決める。ランダムにしない)。
// まだの分は輪郭だけ。会員証を開いたときは、たまった分を左上から順に「ポポポン」と押していく。
// 前回見たときより増えた 1 個は、ほかより少し遅れて大きめに「ポン」と押し、インクがにじむ。
// 今日の来場で付いたスタンプは、朱肉の色(--stamp-today)で押す。

const PAW = (
  <>
    <ellipse cx="12" cy="16.2" rx="5.4" ry="4.6" />
    <ellipse cx="5.2" cy="10.4" rx="2.2" ry="2.8" transform="rotate(-18 5.2 10.4)" />
    <ellipse cx="9.4" cy="6.4" rx="2.3" ry="3" transform="rotate(-6 9.4 6.4)" />
    <ellipse cx="14.6" cy="6.4" rx="2.3" ry="3" transform="rotate(6 14.6 6.4)" />
    <ellipse cx="18.8" cy="10.4" rx="2.2" ry="2.8" transform="rotate(18 18.8 10.4)" />
  </>
);

const BONE = (
  <path
    d="M8.245 10.9H15.755A2.5 2.5 0 1 1 19.19 12A2.5 2.5 0 1 1 15.755 13.1H8.245A2.5 2.5 0 1 1 4.81 12A2.5 2.5 0 1 1 8.245 10.9Z"
    transform="rotate(-35 12 12)"
  />
);

/** 押した跡の傾き(−6〜+6 度)と濃さ(92〜100%)。同じ位置はいつも同じ */
export function stampTilt(i: number): number {
  return ((i * 7) % 13) - 6;
}
export function stampOpacity(i: number): number {
  return 0.92 + ((i * 5) % 9) / 100;
}

/** 押す前の少しの回転(上から押し付けるときに、まっすぐに戻る) */
const SWING = (i: number) => (i % 2 === 0 ? -9 : 8);

/** 押した跡の肉球 1 つ(チェックイン完了の「+1ポイント」の横などにも使う) */
export function PawMark({ size, className }: { size: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      {PAW}
    </svg>
  );
}

function Stamp({
  i,
  on,
  bone,
  fresh,
  today,
  plan,
}: {
  i: number;
  on: boolean;
  bone: boolean;
  fresh: boolean;
  /** 今日の来場で付いたスタンプ(朱肉の色) */
  today: boolean;
  plan: StampPlan;
}) {
  const svg = (
    <svg
      className={`paw${on ? ' on' : ''}${bone ? ' bone' : ''}${fresh ? ' fresh' : ''}${on && today ? ' today' : ''}`}
      viewBox="0 0 24 24"
      width={36}
      height={36}
      aria-hidden="true"
      focusable="false"
      {...(fresh ? { 'data-pon': '' } : {})}
      {...(on && today ? { 'data-today': '' } : {})}
      style={on ? ({ '--tilt': `${stampTilt(i)}deg`, opacity: stampOpacity(i) } as CSSProperties) : undefined}
    >
      {bone ? BONE : PAW}
    </svg>
  );
  const isFresh = fresh && plan.freshDelay !== null;
  const delay = isFresh ? plan.freshDelay : plan.delays.get(i);
  // 動かさないとき(まだの分・動きを減らす設定・同じ日に開き直したとき)は、最初から押された形
  if (!on || delay === undefined || delay === null) return <span className="paw-cell">{svg}</span>;
  const s = delay / 1000;
  return (
    <span className="paw-cell">
      {isFresh ? (
        // インクのにじみ: 肉球のまわりに薄い輪が 1 回広がって消える(ink の 12% → 0)
        <m.span
          className="paw-ink"
          aria-hidden="true"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: [0.12, 0], scale: [0.7, 1.9] }}
          transition={{ delay: (plan.pressAt ?? delay) / 1000, duration: 0.42, ease: [0.2, 0.8, 0.2, 1] }}
        />
      ) : null}
      <m.span
        className="paw-press"
        data-delay={delay}
        initial={{ opacity: 0, scale: isFresh ? 2.1 : 1.6, rotate: SWING(i) }}
        animate={
          isFresh
            ? { opacity: [0, 1, 1, 1], scale: [2.1, 0.88, 1.03, 1], rotate: [SWING(i), 0, 0, 0] }
            : { opacity: [0, 1, 1], scale: [1.6, 0.92, 1], rotate: [SWING(i), 0, 0] }
        }
        transition={
          isFresh
            ? { delay: s, duration: T.freshDuration / 1000, times: [0, T.freshPress, 0.78, 1], ease: ['easeIn', 'easeOut', 'easeInOut'] }
            : { delay: s, duration: T.duration / 1000, times: [0, T.press, 1], ease: ['easeIn', 'easeOut'] }
        }
      >
        {svg}
      </m.span>
    </span>
  );
}

const SEEN_KEY = 'dr.stamps.seen';
const PLAYED_KEY = 'dr.stamps.played';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 覚えられなくても、表示はそのまま
  }
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export type StampLayout = { per: number; points: number; filled: number; tiers: number; today: number[] };

/** スタンプの並び(1 段は無料券 1 枚分。1 枚分を超えた分は 2 段目。最大 2 段) */
export function stampLayout(balance: number, perTicket: number, todayPoints = 0): StampLayout {
  const per = Math.max(1, Math.min(perTicket, 20));
  const points = Math.max(0, balance);
  const tiers = points > per && per <= 10 ? 2 : 1;
  return { per, points, filled: Math.min(points, per), tiers, today: todayStampIndices(points, todayPoints, per * tiers) };
}

/**
 * 会員証を開いたときの、スタンプを押していく計画。開いたとき(このフックを使う部品が出たとき)に 1 回だけ決める。
 * - owner(会員ID)ごとに前回の数を覚え、増えた分の最後の 1 個を「ポン」と押す
 * - 同じ日に同じ数で開き直したときは、押していく動きを付けない(1 日 1 回。覚えられない端末では毎回)
 * - 動きを減らす設定では動かさない
 */
export function useStampPlan({
  balance,
  perTicket,
  owner,
  todayPoints = 0,
}: {
  balance: number;
  perTicket: number;
  owner: string;
  todayPoints?: number;
}) {
  const layout = stampLayout(balance, perTicket, todayPoints);
  const { per, points, tiers } = layout;
  const [plan] = useState<StampPlan>(() => {
    const seenRaw = read(`${SEEN_KEY}.${owner}`);
    const seen = seenRaw === null ? null : Number(seenRaw);
    let fresh: number | null = null;
    if (seen !== null && points > seen && points - 1 < per * tiers) fresh = points - 1;
    const play =
      !prefersReducedMotion() &&
      shouldPlay({ memo: read(`${PLAYED_KEY}.${owner}`), today: toJstDate(new Date()), points, fresh: fresh !== null });
    const on = Array.from({ length: Math.min(points, per * tiers) }, (_, i) => i);
    return planStamps({ on, fresh, bone: per - 1, play });
  });
  useEffect(() => {
    write(`${SEEN_KEY}.${owner}`, String(points));
  }, [owner, points]);
  // 押し終わったら data-stamps="done" にする(画面の確認用)
  const [done, setDone] = useState(!plan.play);
  useEffect(() => {
    if (!plan.play) return;
    write(`${PLAYED_KEY}.${owner}`, `${toJstDate(new Date())}:${points}`);
    const timers = [window.setTimeout(() => setDone(true), plan.end + 50)];
    // 押し付けた瞬間に、対応する端末では軽く震わせる
    if (plan.pressAt !== null) timers.push(window.setTimeout(tapticPon, plan.pressAt));
    return () => timers.forEach((t) => window.clearTimeout(t));
    // 開いたときの 1 回だけ(plan は開いたときに決めたまま変わらない)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);
  return { plan, layout, done };
}

/**
 * スタンプを 5 列で並べる。1 段は無料券 1 枚分(初期値 10 個)で、最後の 1 個は骨。
 * 1 枚分を超えてたまった分は「11個目から」として 2 段目に続ける(最大 2 段)。
 * 動きの間も、読み上げ(role="img" と「ポイント 3 / 10」)は変わらない。
 */
export function PawStamps({
  perTicket,
  plan,
  layout,
  done,
}: {
  perTicket: number;
  plan: StampPlan;
  layout: StampLayout;
  done: boolean;
}) {
  const { per, points, filled, tiers, today } = layout;
  return (
    <div className="paws" data-stamps={plan.play ? (done ? 'done' : 'playing') : 'still'}>
      {Array.from({ length: tiers }, (_, t) => (
        <div key={t} className="paws-tier">
          {t > 0 ? <p className="paws-more">{per + 1}個目から</p> : null}
          <div
            className="paws-grid"
            {...(t === 0
              ? { role: 'img', 'aria-label': `ポイント ${filled} / ${perTicket}` }
              : { role: 'img', 'aria-label': `${per + 1}個目から ${Math.min(points - per, per)} / ${per}` })}
          >
            {Array.from({ length: per }, (_, j) => {
              const i = t * per + j;
              return (
                <Stamp
                  key={i}
                  i={i}
                  on={i < points}
                  bone={j === per - 1}
                  fresh={plan.fresh === i}
                  today={today.includes(i)}
                  plan={plan}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
