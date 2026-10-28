import { useEffect, useState, type CSSProperties } from 'react';

// 会員証のスタンプ(docs/design.md 5章「スタンプ」)。肉球の塗りの SVG と、10 個目の骨の SVG。
// たまった分は押した跡らしく、1つずつ少し傾け、濃さを変える(index から決める。ランダムにしない)。
// まだの分は輪郭だけ。新しく付いた 1 個は、開いたときに 1 回だけ押す動きを付ける。

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

function Stamp({ i, on, bone, fresh }: { i: number; on: boolean; bone: boolean; fresh: boolean }) {
  return (
    <svg
      className={`paw${on ? ' on' : ''}${bone ? ' bone' : ''}${fresh ? ' fresh' : ''}`}
      viewBox="0 0 24 24"
      width={36}
      height={36}
      aria-hidden="true"
      focusable="false"
      style={on ? ({ '--tilt': `${stampTilt(i)}deg`, opacity: stampOpacity(i) } as CSSProperties) : undefined}
    >
      {bone ? BONE : PAW}
    </svg>
  );
}

const SEEN_KEY = 'dr.stamps.seen';

/** 前回この端末で見たポイントの数(なければ null) */
function readSeen(owner: string): number | null {
  try {
    const raw = localStorage.getItem(`${SEEN_KEY}.${owner}`);
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}
function writeSeen(owner: string, n: number) {
  try {
    localStorage.setItem(`${SEEN_KEY}.${owner}`, String(n));
  } catch {
    // 覚えられなくても、表示はそのまま
  }
}

/**
 * スタンプを 5 列で並べる。1 段は無料券 1 枚分(初期値 10 個)で、最後の 1 個は骨。
 * 1 枚分を超えてたまった分は「11個目から」として 2 段目に続ける(最大 2 段)。
 * owner(会員ID)ごとに前回の数を覚え、増えた分の最後の 1 個に押す動きを付ける。
 */
export function PawStamps({ balance, perTicket, owner }: { balance: number; perTicket: number; owner: string }) {
  const per = Math.max(1, Math.min(perTicket, 20));
  const points = Math.max(0, balance);
  // 1 段目の塗る数(読み上げは、いまのまま「ポイント 3 / 10」。1 枚分まで)
  const filled = Math.min(points, per);
  const tiers = points > per && per <= 10 ? 2 : 1;
  const [fresh] = useState<number | null>(() => {
    const seen = readSeen(owner);
    if (seen === null || points <= seen) return null;
    const last = points - 1;
    return last < per * tiers ? last : null;
  });
  useEffect(() => {
    writeSeen(owner, points);
  }, [owner, points]);

  return (
    <div className="paws">
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
              return <Stamp key={i} i={i} on={i < points} bone={j === per - 1} fresh={fresh === i} />;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
