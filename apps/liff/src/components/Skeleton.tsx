import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * 読み込み中の形(docs/design.md 11.1)。読み込んだ後の画面と同じ形・同じ大きさの薄い灰色の面を出す。
 * - Skeleton: 長方形(幅・高さ・角丸を指定)
 * - SkeletonText: 文字の行(最後の行は 60% の幅)。行の高さは文字の大きさ × 行間で、読み込み後の文と同じ高さになる
 * - SkeletonCircle: アバター
 * - SkeletonScreen: 画面の外側。aria-busy と見えない「読み込んでいます」を付け、120ms 待ってから形を出す
 */

type Len = number | string;
const len = (v: Len | undefined) => (typeof v === 'number' ? `${v}px` : v);

export function Skeleton({
  width = '100%',
  height,
  radius,
  className,
  style,
}: {
  width?: Len;
  height: Len;
  radius?: Len;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`sk${className ? ` ${className}` : ''}`}
      style={{ width: len(width), height: len(height), borderRadius: len(radius), ...style }}
    />
  );
}

export function SkeletonText({
  lines = 1,
  size = 15,
  lineHeight = 1.55,
  width = '100%',
  lastWidth = '60%',
  className,
}: {
  lines?: number;
  /** 文字の大きさ(px) */
  size?: number;
  lineHeight?: number;
  /** 文の幅(親の幅に対する割合か px) */
  width?: Len;
  /** 2行以上のときの最後の行の幅(文の幅に対する割合) */
  lastWidth?: Len;
  className?: string;
}) {
  return (
    <span className={`sk-text${className ? ` ${className}` : ''}`} style={{ width: len(width) }}>
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          className="sk-line"
          style={{ height: size * lineHeight, width: lines > 1 && i === lines - 1 ? len(lastWidth) : '100%' }}
        >
          <span className="sk" style={{ height: Math.round(size * 0.8) }} />
        </span>
      ))}
    </span>
  );
}

export function SkeletonCircle({ size, className }: { size: number; className?: string }) {
  return <span className={`sk sk-circle${className ? ` ${className}` : ''}`} style={{ width: size, height: size }} />;
}

/** スケルトンを出すまで待つ時間。速く読み込めたときに一瞬だけ見える「ちらつき」を防ぐ */
const DELAY_MS = 120;
/** 直前までスケルトンが見えていたら(画面の外側から内側へ切り替わったときなど)、待たずにすぐ出す */
let lastVisibleAt = 0;

export function useSkeletonDelay(ms = DELAY_MS): boolean {
  const [show, setShow] = useState(() => performance.now() - lastVisibleAt < 250);
  useEffect(() => {
    if (show) return;
    const t = window.setTimeout(() => setShow(true), ms);
    return () => window.clearTimeout(t);
  }, [ms, show]);
  useEffect(
    () => () => {
      if (show) lastVisibleAt = performance.now();
    },
    [show],
  );
  return show;
}

/** 読み込み中の形を包む。読み上げには「読み込んでいます」とだけ伝え、形そのものは読み上げない */
export function SkeletonBlock({
  children,
  as: Tag = 'div',
  className,
  label = '読み込んでいます',
}: {
  children: ReactNode;
  as?: 'div' | 'main' | 'section';
  className?: string;
  label?: string;
}) {
  const show = useSkeletonDelay();
  return (
    <Tag className={`sk-block${className ? ` ${className}` : ''}`} aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className={`sk-shapes${show ? ' on' : ''}`} aria-hidden="true">
        {children}
      </div>
    </Tag>
  );
}

/** 画面全体の読み込み中(main.screen の形) */
export function SkeletonScreen({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <SkeletonBlock as="main" className={`screen${className ? ` ${className}` : ''}`}>
      {children}
    </SkeletonBlock>
  );
}
