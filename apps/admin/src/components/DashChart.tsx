import type { Chart, ChartConfiguration, Plugin } from 'chart.js';
import { useEffect, useRef, useState } from 'react';

// ダッシュボード(M-05)のグラフ。Chart.js を canvas に直接描く(react-chartjs-2 は使わない)。
// 色は docs/design.md のトークン(アクセント色と灰色の濃淡)を CSS 変数から読む。多色にしない。
// Chart.js は、ダッシュボードを開いたときにだけ読み込む(chart-lib.ts)。

let chartLib: Promise<typeof import('./chart-lib')> | null = null;
const loadChart = () => (chartLib ??= import('./chart-lib'));

export type ChartColors = {
  accent: string;
  accent100: string;
  text: string;
  secondary: string;
  tertiary: string;
  border: string;
  surface: string;
  font: string;
};

function readColors(): ChartColors {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    accent: v('--accent'),
    accent100: v('--accent-100'),
    text: v('--text'),
    secondary: v('--text-secondary'),
    tertiary: v('--text-tertiary'),
    border: v('--border'),
    surface: v('--surface'),
    font: v('--font-sans'),
  };
}

/** ライト・ダークが切り替わったら描き直す */
function useColors(): ChartColors {
  const [colors, setColors] = useState(readColors);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setColors(readColors());
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return colors;
}

/**
 * 横棒の右に値を書くプラグイン(数字を読むのに、指を置かなくてもよいように)。
 * 書式の関数をグラフの設定(options)に入れると Chart.js が呼び出してしまうため、プラグインに閉じ込める。
 */
export function valueLabels(color: string, format: (v: number) => string): Plugin {
  return {
    id: 'drValueLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.fillStyle = color;
      ctx.font = `12px ${getComputedStyle(document.documentElement).getPropertyValue('--font-sans')}`;
      ctx.textBaseline = 'middle';
      chart.data.datasets.forEach((ds, i) => {
        chart.getDatasetMeta(i).data.forEach((el, j) => {
          const raw = ds.data[j];
          if (typeof raw !== 'number') return;
          const { x, y } = el.getProps(['x', 'y'], true) as { x: number; y: number };
          ctx.fillText(format(raw), x + 6, y);
        });
      });
      ctx.restore();
    },
  };
}

/**
 * 1つのグラフ。config は色を受け取って作る。label は画面の読み上げ用の説明(数値の要約)。
 * 高さは固定、幅は親に合わせる。
 */
export function DashChart({
  make,
  label,
  height,
  deps,
}: {
  make: (c: ChartColors) => ChartConfiguration;
  label: string;
  height: number;
  deps: unknown[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const colors = useColors();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let chart: Chart | null = null;
    loadChart()
      .then(({ Chart }) => {
        if (!alive || !ref.current) return;
        Chart.defaults.font.family = colors.font;
        Chart.defaults.font.size = 12;
        Chart.defaults.color = colors.secondary;
        Chart.defaults.borderColor = colors.border;
        const config = make(colors);
        config.options = {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          ...config.options,
          plugins: {
            ...config.options?.plugins,
            tooltip: {
              backgroundColor: colors.text,
              titleColor: colors.surface,
              bodyColor: colors.surface,
              padding: 8,
              cornerRadius: 6,
              displayColors: false,
              ...config.options?.plugins?.tooltip,
            },
          },
        };
        chart = new Chart(ref.current, config);
        setFailed(false);
      })
      .catch((e) => {
        // 1つのグラフが描けなくても、画面のほかの部分は使えるようにする
        console.error(e);
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      chart?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors, ...deps]);
  return (
    <div className="dash-chart" style={{ height }}>
      <canvas ref={ref} role="img" aria-label={label} />
      {failed && <p className="empty">グラフを表示できませんでした。画面を読み込み直してください。</p>}
    </div>
  );
}
