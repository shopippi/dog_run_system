import {
  diffPct,
  SERIES_METRIC_LABELS,
  SERIES_METRICS,
  type DashboardResponse,
  type SeriesBucket,
  type SeriesMetric,
} from '@dr/shared';
import { useId, useState } from 'react';
import { WeatherIcon } from '../../components/WeatherIcon';
import { AreaChart } from './AreaChart';
import { bucketCsv, bucketTick, bucketTitle, md, monthLabel, num, pct } from './format';
import { Panel, Sparkline, type PanelCsv } from './parts';

// KPI のカード(押すと下の大きなグラフが切り替わる)と、大きな面グラフ(docs/design.md 12.1)

export type KpiKey = SeriesMetric | 'repeat';
export const KPI_KEYS: KpiKey[] = ['groups', 'dogs', 'dogsWalkin', 'newHouseholds', 'ticketsUsed', 'repeat'];
const GRAN_LABEL = { hour: '1時間', day: '1日', week: '1週', month: '1か月' } as const;

function kpiOf(data: DashboardResponse, key: KpiKey) {
  const t = data.trend;
  if (key === 'repeat') {
    return {
      label: 'リピート率',
      value: pct(data.repeat.rate),
      unit: '',
      delta: null as number | null,
      prevText: `前の期間 ${pct(t.previousRepeatRate)}`,
      spark: data.repeat.months.map((m) => (m.rate === null ? 0 : m.rate * 100)),
    };
  }
  const meta = SERIES_METRIC_LABELS[key];
  const cur = t.totals[key];
  const prev = t.previousTotals[key];
  return {
    label: meta.label,
    value: num(cur),
    unit: meta.unit,
    delta: diffPct(cur, prev),
    prevText: prev === 0 ? (cur === 0 ? '前の期間と同じ' : '前の期間 0') : `前の期間 ${num(prev)}${meta.unit}`,
    spark: t.current.map((b) => b[key]),
  };
}

export function KpiCards({ data, selected, onSelect }: { data: DashboardResponse; selected: KpiKey; onSelect: (k: KpiKey) => void }) {
  return (
    <section className="panel dsb-kpis" aria-label="期間の集計">
      {KPI_KEYS.map((key) => {
        const k = kpiOf(data, key);
        const up = k.delta !== null && k.delta > 0;
        const down = k.delta !== null && k.delta < 0;
        return (
          <button
            key={key}
            type="button"
            className="dsb-kpi"
            aria-pressed={selected === key}
            aria-label={`${k.label} ${k.value}${k.value !== '—' ? k.unit : ''}。${k.delta === null ? k.prevText : `前の期間より${Math.abs(k.delta)}%${up ? '多い' : down ? '少ない' : '同じ'}`}。押すと下のグラフに出します`}
            onClick={() => onSelect(key)}
          >
            <span className="dsb-kpi-l">{k.label}</span>
            <span className="dsb-kpi-v">
              {k.value}
              {k.unit && k.value !== '—' ? <small>{k.unit}</small> : null}
            </span>
            <span className={`dsb-kpi-d${down ? ' down' : ''}`}>
              {k.delta === null ? (
                k.prevText
              ) : (
                <>
                  {up ? '▲' : down ? '▼' : '±'} {Math.abs(k.delta)}%<span className="dsb-kpi-dsub">前の期間より</span>
                </>
              )}
            </span>
            <Sparkline values={k.spark} />
          </button>
        );
      })}
    </section>
  );
}

const memoOf = (b: SeriesBucket) => b.notes.filter(Boolean);

export function TrendPanel({ data, metric }: { data: DashboardResponse; metric: KpiKey }) {
  const [compare, setCompare] = useState(true);
  const compareId = useId();
  const t = data.trend;
  const g = t.granularity;
  const withYear = data.from.slice(0, 4) !== data.to.slice(0, 4);
  const prevLabel =
    g === 'hour'
      ? `${md(t.previous.from.slice(0, 10))} ${Number(t.previous.from.slice(11, 13))}時〜${md(t.previous.to.slice(0, 10))} ${Number(t.previous.to.slice(11, 13))}時台`
      : `${md(t.previous.from)}〜${md(t.previous.to)}`;

  if (metric === 'repeat') {
    const months = data.repeat.months;
    const prevMonths = t.previousRepeatMonths.slice(-months.length);
    const values = months.map((m) => (m.rate === null ? 0 : Math.round(m.rate * 100)));
    const prev = compare ? months.map((_, i) => { const p = prevMonths[i - (months.length - prevMonths.length)]; return p?.rate == null ? 0 : Math.round(p.rate * 100); }) : null;
    return (
      <Panel
        title="リピート率の推移"
        note={`初めて来た月ごとの、${data.settings.repeatDays}日以内に2回目に来たおうちの割合です。${data.repeat.pending ? `まだ${data.settings.repeatDays}日たっていないおうちが${data.repeat.pending}軒あり、これから上がることがあります。` : ''}`}
        actions={<CompareToggle id={compareId} on={compare} set={setCompare} />}
        csv={(): PanelCsv => ({
          unit: '初めて来た月ごとに1行',
          columns: [
            { name: '初めて来た月', desc: '年-月' },
            { name: '初めて来たおうち(軒)', desc: 'その月に初めて来場したおうち' },
            { name: '2回目に来たおうち(軒)', desc: `初回から${data.settings.repeatDays}日以内に2回目に来たおうち` },
            { name: '判定待ち(軒)', desc: `まだ${data.settings.repeatDays}日たっていないおうち` },
            { name: 'リピート率(%)', desc: '2回目に来たおうち ÷ 初めて来たおうち' },
          ],
          rows: months.map((m) => [m.month, m.firstTimers, m.repeaters, m.pending, m.rate === null ? '' : Math.round(m.rate * 1000) / 10]),
        })}
        wide
      >
        <Legend compare={compare} prevLabel={prevLabel} marks={false} />
        <AreaChart
          ticks={months.map((m) => monthLabel(m.month, withYear))}
          values={values}
          previous={prev}
          percent
          label={`リピート率の推移。${months.map((m) => `${monthLabel(m.month, true)} ${pct(m.rate)}`).join('、')}`}
          empty="この期間に初めて来たおうちはありません"
          tooltip={(i) => {
            const m = months[i]!;
            return (
              <>
                <p className="dsb-tip-title">{monthLabel(m.month, true)}に初めて来たおうち</p>
                <dl className="dsb-tip-rows">
                  <Row label="リピート率" value={pct(m.rate)} strong />
                  <Row label="初めて来たおうち" value={`${m.firstTimers}軒`} />
                  <Row label="2回目に来たおうち" value={`${m.repeaters}軒`} />
                  {m.pending > 0 && <Row label="判定待ち" value={`${m.pending}軒`} />}
                  {prev && <Row label="前の期間" value={`${prev[i]}%`} muted />}
                </dl>
              </>
            );
          }}
        />
      </Panel>
    );
  }

  const meta = SERIES_METRIC_LABELS[metric];
  const values = t.current.map((b) => b[metric]);
  const prev = compare ? t.previousBuckets.map((b) => b[metric]) : null;
  const ticks = t.current.map((b) => bucketTick(b, g, withYear));
  const total = t.totals[metric];
  return (
    <Panel
      title={`${meta.label}の推移`}
      note={`${GRAN_LABEL[g]}ごとの${meta.label}です(${meta.desc})。点線は前の同じ長さの期間(${prevLabel})です。`}
      actions={<CompareToggle id={compareId} on={compare} set={setCompare} />}
      csv={(): PanelCsv => ({
        unit: `${GRAN_LABEL[g]}ごとに1行`,
        columns: [
          { name: '区切り', desc: g === 'hour' ? '日付と時(日本時間)' : '日付(週・月のときは始まり〜終わり)' },
          ...SERIES_METRICS.map((m) => ({ name: `${SERIES_METRIC_LABELS[m].label}(${SERIES_METRIC_LABELS[m].unit})`, desc: SERIES_METRIC_LABELS[m].desc })),
          { name: '会員の来場組数(組)', desc: '会員のおうちのチェックインの件数' },
          { name: '前の期間の区切り', desc: '比べる前の期間の、同じ位置の区切り' },
          { name: `前の期間の${meta.label}(${meta.unit})`, desc: `前の期間の同じ位置の${meta.label}` },
          ...(g === 'day' ? [{ name: '天気', desc: '晴れ / 曇り / 雨' }, { name: '最高気温(℃)', desc: 'アメダスの観測値' }] : []),
          { name: 'イベント', desc: 'その区切りのイベント' },
          { name: 'その日のメモ', desc: 'その区切りのメモの1行目' },
        ],
        rows: t.current.map((b, i) => {
          const p = t.previousBuckets[i];
          return [
            bucketCsv(b, g),
            ...SERIES_METRICS.map((m) => b[m]),
            b.memberGroups,
            p?.start ? bucketCsv(p, g) : '',
            p?.start ? p[metric] : '',
            ...(g === 'day' ? [b.weather, b.tempMax] : []),
            b.events.join(' / '),
            memoOf(b).join(' / '),
          ];
        }),
      })}
      wide
    >
      <Legend compare={compare} prevLabel={prevLabel} marks={t.current.some((b) => b.notes.length > 0)} />
      <AreaChart
        ticks={ticks}
        values={values}
        previous={prev}
        marks={t.current.map((b) => b.notes.length > 0)}
        format={(v) => num(v)}
        label={`${meta.label}の推移。合計 ${num(total)}${meta.unit}。前の期間 ${num(t.previousTotals[metric])}${meta.unit}。`}
        empty="この期間の来場はまだありません"
        tooltip={(i) => {
          const b = t.current[i]!;
          const p = t.previousBuckets[i];
          const memo = memoOf(b);
          return (
            <>
              <p className="dsb-tip-title">
                {bucketTitle(b, g)}
                {g === 'day' && b.weather ? (
                  <span className="dsb-tip-wx">
                    <WeatherIcon kind={b.weather} size={14} />
                    {b.weather}
                    {b.tempMax !== null ? ` ${b.tempMax}℃` : ''}
                  </span>
                ) : null}
              </p>
              {b.closed ? <p className="dsb-tip-note">臨時休業日</p> : null}
              <dl className="dsb-tip-rows">
                {SERIES_METRICS.map((m) => (
                  <Row key={m} label={SERIES_METRIC_LABELS[m].label} value={`${num(b[m])}${SERIES_METRIC_LABELS[m].unit}`} strong={m === metric} />
                ))}
                {prev && p?.start ? <Row label={`前の期間(${bucketTitle(p, g)})`} value={`${num(p[metric])}${meta.unit}`} muted /> : null}
              </dl>
              {b.events.length > 0 && <p className="dsb-tip-note">イベント: {b.events.join('・')}</p>}
              {memo.length > 0 && <p className="dsb-tip-note">メモ: {memo[0]}{memo.length > 1 ? ` ほか${memo.length - 1}件` : ''}</p>}
            </>
          );
        }}
      />
    </Panel>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`dsb-tip-row${strong ? ' strong' : ''}${muted ? ' muted' : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function CompareToggle({ id, on, set }: { id: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <label className="check dsb-compare" htmlFor={id}>
      <input id={id} type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      前の期間と比べる
    </label>
  );
}

function Legend({ compare, prevLabel, marks }: { compare: boolean; prevLabel: string; marks: boolean }) {
  return (
    <ul className="dsb-legend" aria-label="グラフの見方">
      <li>
        <span className="dsb-sw" aria-hidden="true" />
        この期間
      </li>
      {compare && (
        <li>
          <span className="dsb-sw dashed" aria-hidden="true" />
          前の期間({prevLabel})
        </li>
      )}
      {marks && (
        <li>
          <span className="dsb-sw mark" aria-hidden="true" />
          メモのある日
        </li>
      )}
    </ul>
  );
}
