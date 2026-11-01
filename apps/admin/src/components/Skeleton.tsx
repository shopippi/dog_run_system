import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

// 読み込み中の形(docs/design.md 11.1)。読み込んだ後の画面と同じ形・同じ大きさの薄い灰色の面を出す。
// 画面ごとのスケルトンは、本物と同じ部品のクラス(行・パネル・数値ブロック)の中に、ここの形を置いて作る。

type Size = number | string;

/** 長方形の面。幅・高さ・角丸を指定する */
export function Skeleton({ w = '100%', h = 16, r, className = '', style }: { w?: Size; h?: Size; r?: Size; className?: string; style?: CSSProperties }) {
  return <span className={`sk ${className}`} style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

/** アバターの丸 */
export function SkeletonCircle({ size = 40 }: { size?: number }) {
  return <Skeleton w={size} h={size} r="50%" className="sk-circle" />;
}

/**
 * 文字の行。1行の高さは本物の文字と同じ(文字の大きさ × 行間)にして、中に少し細い面を置く。
 * 複数行のときは、最後の行を 60% の幅にする。
 */
export function SkeletonText({
  lines = 1,
  size = 14,
  lh = 1.55,
  w = '100%',
  last = '60%',
  className = '',
}: {
  lines?: number;
  /** 文字の大きさ(px) */
  size?: number;
  /** 行間(倍率) */
  lh?: number;
  w?: Size;
  last?: Size;
  className?: string;
}) {
  return (
    <span className={`sk-text ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="sk-line" style={{ height: size * lh }}>
          <Skeleton w={lines > 1 && i === lines - 1 ? last : w} h={Math.round(size * 0.78)} r={4} />
        </span>
      ))}
    </span>
  );
}

/** 200ms 以内に読み込めたときのちらつきを防ぐため、少し待ってから true にする */
export function useDelayed(ms = 120): boolean {
  return useDelayedFlag(true, ms);
}

/** flag が ms のあいだ続けて true のときだけ true(読み直しが長引いたときだけスケルトンに替える) */
export function useDelayedFlag(flag: boolean, ms = 120): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!flag) {
      setLate(false);
      return;
    }
    if (ms <= 0) {
      setLate(true);
      return;
    }
    const t = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(t);
  }, [flag, ms]);
  return flag && late;
}

/**
 * 読み込み中のまとまり。外側に aria-busy と、見えない「読み込んでいます」を1つ置く。
 * スケルトン(children)は 120ms 待ってから出し、読み上げからは隠す。
 */
export function Loading({
  children,
  label = '読み込んでいます',
  className = '',
  delay = 120,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
  /** スケルトンを出すまでの待ち(ms)。すでに待ったあとなら 0 */
  delay?: number;
}) {
  const shown = useDelayed(delay);
  return (
    <div className={`sk-wrap ${className}`} aria-busy="true">
      <span className="sr-only">{label}</span>
      {shown && (
        <div className="sk-body" aria-hidden="true">
          {children}
        </div>
      )}
    </div>
  );
}

/** 数値ブロック(ラベル 12px と 値 24px)の形。本物の .kpis / .kpi の中に置く */
export function SkeletonKpis({ n, className = 'kpis', note = false }: { n: number; className?: string; note?: boolean }) {
  return (
    <div className={className}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="kpi">
          <SkeletonText size={12} w={64} />
          <span className="sk-line" style={{ height: 30 }}>
            <Skeleton w={56} h={22} r={4} />
          </span>
          {note && <SkeletonText size={12} w="70%" />}
        </div>
      ))}
    </div>
  );
}

/** ページの頭(道しるべ・タイトル・使い方)の形。ページ全体を読み込むとき(ログインの確認中)に使う */
export function SkeletonPageHead({ crumb = false }: { crumb?: boolean }) {
  return (
    <div className="page-head">
      <div className="page-head-main">
        {crumb && <SkeletonText size={13} w={180} />}
        <span className="sk-line" style={{ height: 27 }}>
          <Skeleton w={160} h={20} r={4} />
        </span>
        <SkeletonText size={13} lines={2} w="100%" last="70%" className="sk-howto" />
      </div>
    </div>
  );
}

/**
 * 一覧の行の形(アバター・2行の文字・右の小さな面)。本物の行のクラス(rowClass)をそのまま使い、高さを合わせる。
 * cells の順番は、本物の行のグリッドの順番に合わせる。
 */
export function SkeletonRows({ n = 5, render }: { n?: number; render: (i: number) => ReactNode }) {
  return <>{Array.from({ length: n }, (_, i) => render(i))}</>;
}

/** 控えめボタン(ghost。枠なしの文字だけ)の形。押せる高さの中に、文字の幅の細い面を置く */
export function SkeletonGhost({ w = 56 }: { w?: number }) {
  return (
    <span className="sk-ghost">
      <Skeleton w={w} h={12} r={4} />
    </span>
  );
}
