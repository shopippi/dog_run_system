import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

// 大きな面グラフ(docs/design.md 12.1)。線 + 下を 12% の薄い塗り。前の期間は同じ色の点線。
// カーソル(指・キーボードの ← →)を乗せると、縦の補助線と、その区切りの値をすべて並べた吹き出しを出す。
// メモのある区切りには、横軸の下に小さな印を付ける。SVG で描く(読み込みを軽くし、見た目を細かく決めるため)。

export type AreaChartProps = {
  ticks: string[];
  values: number[];
  previous?: number[] | null;
  /** メモのある区切り */
  marks?: boolean[];
  height?: number;
  /** 読み上げ用の要約 */
  label: string;
  /** 値の書式(縦軸・吹き出し) */
  format?: (v: number) => string;
  /** 吹き出しの中身 */
  tooltip: (i: number) => ReactNode;
  empty?: string;
  /** 値が 0〜100 の割合のとき */
  percent?: boolean;
};

const PAD = { left: 44, right: 14, top: 14, bottom: 40 };

function niceMax(v: number, percent: boolean): { max: number; step: number } {
  if (percent) return { max: 100, step: 25 };
  if (v <= 0) return { max: 4, step: 1 };
  const raw = v / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const cands = (mag >= 10 ? [1, 2, 2.5, 5, 10] : [1, 2, 5, 10]).map((m) => m * mag);
  const s = Math.max(1, cands.find((c) => c >= raw) ?? 10 * mag);
  return { max: Math.ceil(v / s) * s, step: s };
}

export function AreaChart({ ticks, values, previous, marks, height = 280, label, format = String, tooltip, empty, percent = false }: AreaChartProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [active, setActive] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    setWidth(el.clientWidth || 800);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 800));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const t = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const n = values.length;
  const plotW = Math.max(10, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const all = [...values, ...(previous ?? [])];
  const { max, step } = niceMax(Math.max(0, ...all), percent);
  const x = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const linePath = (list: (number | null)[]) => {
    let d = '';
    let pen = false;
    list.forEach((v, i) => {
      if (v === null || Number.isNaN(v)) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const line = linePath(values);
  const area = n > 0 ? `${line}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` : '';
  const prevLine = previous ? linePath(previous) : '';
  const yTicks = Array.from({ length: Math.round(max / step) + 1 }, (_, k) => k * step);
  // 横軸の文字は、間が 64px 以上空くように間引く
  const every = Math.max(1, Math.ceil((n * 64) / plotW));
  const isEmpty = values.every((v) => v === 0) && (!previous || previous.every((v) => v === 0));

  const pick = (clientX: number) => {
    const el = wrap.current;
    if (!el || n === 0) return;
    const r = el.getBoundingClientRect();
    const px = clientX - r.left - PAD.left;
    const i = n <= 1 ? 0 : Math.round((px / plotW) * (n - 1));
    setActive(Math.min(n - 1, Math.max(0, i)));
  };
  const onKey = (e: KeyboardEvent) => {
    if (n === 0) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setActive((a) => {
        const cur = a ?? (e.key === 'ArrowRight' ? -1 : n);
        return Math.min(n - 1, Math.max(0, cur + (e.key === 'ArrowRight' ? 1 : -1)));
      });
    } else if (e.key === 'Escape') setActive(null);
  };

  const tipLeft = active === null ? 0 : x(active);
  const flip = tipLeft > width * 0.6;

  return (
    <div
      ref={wrap}
      className={`dsb-area${ready ? ' ready' : ''}`}
      style={{ height }}
      tabIndex={0}
      role="group"
      aria-label={`${label}(← → で区切りごとの値を読めます)`}
      onPointerMove={(e) => pick(e.clientX)}
      onPointerDown={(e) => pick(e.clientX)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
      onKeyDown={onKey}
      onBlur={() => setActive(null)}
    >
      <svg width={width} height={height} role="img" aria-label={label} focusable="false">
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={PAD.left + plotW}
              y1={y(t)}
              y2={y(t)}
              className={t === 0 ? 'dsb-axis-zero' : 'dsb-gridline'}
            />
            <text x={PAD.left - 8} y={y(t)} className="dsb-tick" textAnchor="end" dominantBaseline="middle">
              {percent ? `${t}%` : format(t)}
            </text>
          </g>
        ))}
        {ticks.map((t, i) =>
          i % every === 0 ? (
            <text key={i} x={x(i)} y={PAD.top + plotH + 18} className="dsb-tick" textAnchor={n > 1 && i === 0 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'}>
              {t}
            </text>
          ) : null,
        )}
        {marks?.map((m, i) =>
          m ? <rect key={`m${i}`} className="dsb-mark" x={x(i) - 3} y={PAD.top + plotH + 26} width={6} height={6} rx={1} /> : null,
        )}
        {prevLine && <path d={prevLine} className="dsb-prev" fill="none" />}
        {area && <path d={area} className="dsb-fill" />}
        {line && <path d={line} className="dsb-line" fill="none" />}
        {active !== null && (
          <g>
            <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotH} className="dsb-cross" />
            {previous && previous[active] !== undefined && <circle cx={x(active)} cy={y(previous[active]!)} r={3.5} className="dsb-dot-prev" />}
            <circle cx={x(active)} cy={y(values[active]!)} r={4} className="dsb-dot" />
          </g>
        )}
      </svg>
      {isEmpty && empty && <p className="dsb-area-empty">{empty}</p>}
      {active !== null && (
        <div
          className="dsb-tip"
          role="status"
          style={flip ? { right: width - tipLeft + 12, top: PAD.top } : { left: tipLeft + 12, top: PAD.top }}
        >
          {tooltip(active)}
        </div>
      )}
    </div>
  );
}
