import type { Bar, CsvColumn, CsvValue } from '@dr/shared';
import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { num, savePanelCsv } from './format';

// ダッシュボードの部品: パネル(右上に「CSV」)・内訳の横棒の表・スパークライン

/** パネルの CSV に入れる、施設名と期間 */
export type DashInfo = { facilityName: string; period: string; from: string; to: string };
export const DashCtx = createContext<DashInfo>({ facilityName: '', period: '', from: '', to: '' });

export type PanelCsv = { unit: string; columns: CsvColumn[]; rows: CsvValue[][]; notes?: string[] };

/** パネル。タイトル(14/600)と説明、右上に操作と「CSV」 */
export function Panel({
  title,
  note,
  csv,
  actions,
  children,
  className = '',
  wide = false,
}: {
  title: string;
  note?: ReactNode;
  csv?: () => PanelCsv;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  const headingId = useId();
  return (
    <section className={`panel dsb-panel${wide ? ' dsb-wide' : ''} ${className}`} aria-labelledby={headingId}>
      <div className="dsb-panel-head">
        <div className="dsb-panel-title">
          <h2 id={headingId}>{title}</h2>
          {note ? <p className="dsb-note">{note}</p> : null}
        </div>
        {(actions || csv) && (
          <div className="dsb-panel-acts">
            {actions}
            {csv && <CsvButton title={title} make={csv} />}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

export function CsvButton({ title, make }: { title: string; make: () => PanelCsv }) {
  const info = useContext(DashCtx);
  const toast = useToast();
  return (
    <button
      type="button"
      className="btn ghost dsb-csv"
      aria-label={`${title}をCSVで保存`}
      onClick={() => {
        const t = make();
        const fileName = `${title.replace(/[\\/:*?"<>|]/g, '')}_${info.from}〜${info.to}.csv`;
        savePanelCsv({ title, facilityName: info.facilityName, period: info.period, fileName, ...t });
        toast(`「${fileName}」を保存しました。`);
      }}
    >
      <Icon name="download" size={16} />
      CSV
    </button>
  );
}

/**
 * 内訳の横棒の表(Cloudflare の「上位の国」の表と同じ形。docs/design.md 12.1)。
 * 行は「名前・横棒・数・割合」。横棒は 1系列目の色の 20% の塗り。
 */
export function BarTable({
  bars,
  unit,
  label,
  base,
  decimals = false,
  showPct = true,
  empty = 'この期間の記録はまだありません。',
}: {
  bars: Bar[];
  unit: string;
  label: string;
  /** 割合の分母(省略すると合計) */
  base?: number;
  decimals?: boolean;
  showPct?: boolean;
  empty?: string;
}) {
  if (bars.length === 0 || bars.every((b) => b.count === 0)) return <p className="empty">{empty}</p>;
  const max = Math.max(...bars.map((b) => b.count));
  const total = base ?? bars.reduce((s, b) => s + b.count, 0);
  const fmt = (v: number) => (decimals ? v.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : num(v));
  return (
    <table className="dsb-bars" aria-label={label}>
      <thead className="sr-only">
        <tr>
          <th scope="col">項目</th>
          <th scope="col">数</th>
          {showPct && <th scope="col">割合</th>}
        </tr>
      </thead>
      <tbody>
        {bars.map((b) => (
          <tr key={b.label} className={b.label === '未回答' || b.label === 'そのほか' ? 'dsb-muted' : undefined}>
            <th scope="row">
              <span className="dsb-bar" style={{ width: `${max ? (b.count / max) * 100 : 0}%` }} aria-hidden="true" />
              <span className="dsb-bar-label" title={b.label}>
                {b.label}
              </span>
            </th>
            <td className="n">
              {fmt(b.count)}
              <small>{unit}</small>
            </td>
            {showPct && <td className="n dsb-pct">{total ? `${Math.round((b.count / total) * 100)}%` : '—'}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 横棒の表の CSV(項目・数・割合) */
export function barsCsv(bars: Bar[], itemName: string, unit: string, desc: string, base?: number): PanelCsv {
  const total = base ?? bars.reduce((s, b) => s + b.count, 0);
  return {
    unit: '1項目1行',
    columns: [
      { name: itemName, desc: '内訳の項目' },
      { name: `数(${unit})`, desc },
      { name: '割合(%)', desc: base ? '分母に対する割合(1つが複数に入るので、合計は100%を超えることがあります)' : '合計に対する割合' },
    ],
    rows: bars.map((b) => [b.label, b.count, total ? Math.round((b.count / total) * 1000) / 10 : '']),
  };
}

/** 小さな折れ線(高さ 32、線 1.5px) */
export function Sparkline({ values, color = 'var(--chart-1)' }: { values: number[]; color?: string }) {
  const w = 120;
  const h = 32;
  if (values.length < 2) return <svg className="dsb-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true" />;
  const max = Math.max(1, ...values);
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`);
  return (
    <svg className="dsb-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill={color} opacity={0.12} />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** セグメント(2〜4択)。ラジオの役割で、選択中は白い面 */
export function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
  className = '',
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={`dsb-seg ${className}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 開け閉めの状態(小さなもの) */
export function useToggle(initial = false) {
  const [on, set] = useState(initial);
  return [on, () => set((v) => !v), set] as const;
}
