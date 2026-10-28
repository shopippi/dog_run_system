import { addDays, addMonthsToDate, toJstDate, type Bar, type DashboardResponse } from '@dr/shared';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DashChart, valueLabels, type ChartColors } from '../components/DashChart';
import { DogFace } from '../components/DogFace';
import { ErrorNotice } from '../components/ErrorNotice';
import { PageHead } from '../components/PageHead';
import { adminApi } from '../lib/api';

// M-05 ダッシュボード(A-01)。指標の定義は要件定義書 13章。
// 並び: 数値ブロック → 推移の折れ線 → 横棒の構成 → 散布図 → 表(イベント・継続状況) → 休眠の一覧

type PeriodKey = 'this' | 'last' | '3m' | '12m' | 'custom';
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'this', label: '今月' },
  { key: 'last', label: '先月' },
  { key: '3m', label: '過去3か月' },
  { key: '12m', label: '過去12か月' },
  { key: 'custom', label: '期間を選ぶ' },
];

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
function md(ymd: string) {
  const [, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return `${m}月${d}日`;
}
function mdw(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return `${m}月${d}日(${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}
/**
 * 期間の見出し。年をまたぐ期間や去年の月でも分かるよう、必ず年を入れる。
 * 1か月まるごと: 「2026年10月」/ 月の初めから途中まで: 「2026年10月(1日〜28日)」/
 * それ以外: 「2026年8月1日(土)〜10月28日(水)」(年が変われば終わりにも年を入れる)
 */
function periodLabel(from: string, to: string) {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  if (from === to) return `${fy}年${mdw(from)}`;
  if (fy === ty && fm === tm && fd === 1) {
    return to === lastDay(to.slice(0, 7)) ? `${fy}年${fm}月` : `${fy}年${fm}月(1日〜${td}日)`;
  }
  return `${fy}年${mdw(from)}〜${fy === ty ? '' : `${ty}年`}${mdw(to)}`;
}
function slashDate(ymd: string) {
  const [, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return `${m}/${d}`;
}
function monthLabel(ym: string, withYear: boolean) {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return withYear ? `${y}年${m}月` : `${m}月`;
}
const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`);
const num = (n: number) => n.toLocaleString('ja-JP');
const lastDay = (ym: string) => addDays(addMonthsToDate(`${ym}-01`, 1), -1);

function rangeOf(key: PeriodKey, today: string, custom: { from: string; to: string }) {
  const month = today.slice(0, 7);
  if (key === 'this') return { from: `${month}-01`, to: today };
  if (key === 'last') {
    const prev = addMonthsToDate(`${month}-01`, -1).slice(0, 7);
    return { from: `${prev}-01`, to: lastDay(prev) };
  }
  if (key === '3m') return { from: addMonthsToDate(`${month}-01`, -2), to: today };
  if (key === '12m') return { from: addMonthsToDate(`${month}-01`, -11), to: today };
  return custom;
}

export function DashboardPage() {
  const today = toJstDate(new Date());
  const [period, setPeriod] = useState<PeriodKey>('this');
  const [custom, setCustom] = useState({ from: addDays(today, -29), to: today });
  const { from, to } = rangeOf(period, today, custom);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!from || !to || from > to) return;
    let alive = true;
    setBusy(true);
    adminApi<DashboardResponse>(`/dashboard?from=${from}&to=${to}`)
      .then((r) => {
        if (!alive) return;
        setData(r);
        setError(null);
      })
      .catch((e) => alive && setError(e))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [from, to, reloadKey]);

  return (
    <div className="page">
      <PageHead
        title="ダッシュボード"
        howto="来場の数・リピート率・天気や曜日との関係などを、期間を選んで見られます。取り消した来場と臨時休業日は数えません。グラフの点や棒に指を置くと、くわしい数が出ます。"
      />
      <section className="panel dash-period" aria-label="期間">
        <div className="chips" role="radiogroup" aria-label="期間">
          {PERIODS.map((p) => (
            <label key={p.key}>
              <input type="radio" name="dash-period" checked={period === p.key} onChange={() => setPeriod(p.key)} />
              <span>{p.label}</span>
            </label>
          ))}
        </div>
        {period === 'custom' && (
          <div className="dash-custom">
            <div className="field">
              <label htmlFor="dash-from">始まり</label>
              <input
                id="dash-from"
                type="date"
                value={custom.from}
                max={custom.to}
                onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="dash-to">終わり</label>
              <input
                id="dash-to"
                type="date"
                value={custom.to}
                min={custom.from}
                onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))}
              />
            </div>
          </div>
        )}
        <p className="sub-text dash-period-label" role="status">
          {periodLabel(from, to)}
          {data && data.from === from && data.to === to ? `(営業日 ${data.totals.openDays}日)` : ''}
          {busy ? ' 読み込んでいます…' : ''}
        </p>
      </section>
      {error ? <ErrorNotice error={error} onRetry={() => setReloadKey((k) => k + 1)} /> : null}
      {!data ? !error && <p className="loading">読み込んでいます…</p> : <Body data={data} busy={busy} />}
    </div>
  );
}

function Body({ data, busy }: { data: DashboardResponse; busy: boolean }) {
  const t = data.totals;
  const full = data.scope === 'full';
  return (
    <div className="dash" aria-busy={busy}>
      <section className="panel" aria-label="期間の集計">
        <div className="dash-kpis">
          <Kpi label="来場頭数" value={num(t.dogs)} unit="頭" note={`会員以外 ${num(t.dogsWalkin)}頭`} />
          <Kpi label="来場組数" value={num(t.groups)} unit="組" />
          <Kpi label="1日あたりの頭数" value={t.avgDogsPerDay === null ? '—' : String(t.avgDogsPerDay)} unit="頭" />
          <Kpi label="新しいおうち" value={num(t.newHouseholds)} unit="軒" />
          <Kpi label="リピート率" value={pct(data.repeat.rate)} note={`${data.settings.repeatDays}日以内に2回目`} />
          <Kpi label="無料券の利用" value={pct(t.ticketUseRate)} note={`発行 ${t.ticketsIssued}枚・利用 ${t.ticketsUsed}枚`} />
        </div>
      </section>

      <Trend key={`${data.from}/${data.to}`} data={data} />

      <div className="dash-grid">
        <Panel title="リピート率(初めて来た月ごと)" note={repeatNote(data)}>
          <RepeatChart data={data} />
        </Panel>
        <Panel title="新しいおうちと無料券(月ごと)" note="新しく会員IDを発行したおうちの数と、無料券の発行・利用の枚数です。">
          <MonthlyChart data={data} />
        </Panel>
      </div>

      <div className="dash-grid">
        <Panel title="来場頻度" note="期間中に何回来たかごとの、おうちの数です。">
          <BarChart bars={data.frequency} unit="軒" label="来場頻度" />
        </Panel>
        <Panel title="天気ごとの1日あたりの頭数" note={weatherNote(data)}>
          <BarChart
            bars={data.weather.byKind.map((w) => ({ label: `${w.kind}(${w.days}日)`, count: w.avgDogs ?? 0 }))}
            unit="頭"
            label="天気ごとの1日あたりの頭数"
            decimals
          />
        </Panel>
        <Panel title="曜日ごとの1日あたりの頭数" note="平日・土曜・日曜・祝日ごとの平均です。土日の祝日は土曜・日曜に入ります。">
          <BarChart
            bars={data.dayTypes.map((d) => ({ label: `${d.label}(${d.days}日)`, count: d.avgDogs ?? 0 }))}
            unit="頭"
            label="曜日ごとの1日あたりの頭数"
            decimals
          />
        </Panel>
        <Panel title="犬種" note={`期間中に来たワンちゃん ${data.dogs.total}頭の、登録の犬種です。`}>
          <BarChart bars={data.dogs.breeds} unit="頭" label="犬種" limit={12} />
        </Panel>
        <Panel title="サイズ">
          <BarChart bars={data.dogs.sizes} unit="頭" label="サイズ" />
        </Panel>
        <Panel title="年齢" note="期間の終わりの日の年齢です。7歳からがシニアです。">
          <BarChart bars={data.dogs.ages} unit="頭" label="年齢" />
        </Panel>
        <Panel title="飼い主の年代" note={`チェックインした家族 ${data.owners.members}人です。`}>
          <BarChart bars={data.owners.ageGroups} unit="人" label="飼い主の年代" />
        </Panel>
        <Panel title="飼い主の性別">
          <BarChart bars={data.owners.genders} unit="人" label="飼い主の性別" />
        </Panel>
        <Panel title="お住まいの地域" note={`来場したおうち ${data.owners.households}軒の、郵便番号の上3桁です。`}>
          <BarChart bars={data.owners.areas} unit="軒" label="お住まいの地域" />
        </Panel>
        <Panel title="知ったきっかけ">
          <BarChart bars={data.owners.referrals} unit="軒" label="知ったきっかけ" />
        </Panel>
        <Panel title="ふだんの来場手段">
          <BarChart bars={data.owners.transports} unit="軒" label="ふだんの来場手段" />
        </Panel>
        {full && data.family && (
          <Panel title="家族での利用" note="期間中に来場したおうちのうち、LINEでつながっている家族が2人以上のおうちです。">
            <FamilyBlock family={data.family} />
          </Panel>
        )}
      </div>

      {full && data.surveys && data.surveys.length > 0 && (
        <div className="dash-grid">
          {data.surveys.map((s) => (
            <Panel
              key={s.id}
              title={s.label}
              note={`追加したアンケート。これまでに${s.answered}件の回答${s.visible ? '' : '(いまは聞いていない質問)'}です。`}
            >
              {s.kind === 'choice' ? (
                <BarChart bars={s.answers} unit="件" label={s.label} />
              ) : s.recentTexts.length === 0 ? (
                <p className="empty">まだ回答はありません。</p>
              ) : (
                <ul className="dash-texts" aria-label={`${s.label}の新しい回答`}>
                  {s.recentTexts.map((text, i) => (
                    <li key={i}>{text}</li>
                  ))}
                </ul>
              )}
            </Panel>
          ))}
        </div>
      )}

      <Panel title="最高気温と来場頭数" note={weatherNote(data)}>
        <ScatterChart data={data} />
      </Panel>

      <Panel title="イベントの効果" note="イベントの日の頭数を、同じ月・同じ曜日区分のイベントのない日の平均と比べています。">
        <EventsTable data={data} />
      </Panel>

      {full && data.cohort && (
        <Panel
          title="おうちの継続状況"
          note="期間中に初めて来たおうちを、初めて来た月ごとにまとめ、その後の各月にも来たおうちの割合を出しています。"
        >
          <CohortTable cohort={data.cohort} />
        </Panel>
      )}

      {full && data.dormant && (
        <Panel
          title="しばらく来ていない常連さん"
          note={`これまでに${data.settings.dormantMinVisits}回以上来て、${data.settings.dormantDays}日以上来ていないおうちです(今日の時点)。${
            data.dormant.total > data.dormant.households.length
              ? `全${data.dormant.total}軒のうち、来場の多い${data.dormant.households.length}軒を出しています。`
              : ''
          }`}
        >
          <DormantList dormant={data.dormant} />
        </Panel>
      )}
    </div>
  );
}

function repeatNote(d: DashboardResponse) {
  const base = `期間中に初めて来たおうち ${d.repeat.firstTimers}軒のうち、${d.settings.repeatDays}日以内に2回目に来たおうちの割合です。`;
  return d.repeat.pending > 0
    ? `${base}まだ${d.settings.repeatDays}日たっていないおうちが${d.repeat.pending}軒あり、これから上がることがあります。`
    : base;
}
function weatherNote(d: DashboardResponse) {
  return d.weather.source
    ? `天気: ${d.weather.source}のアメダス(${d.weather.station ?? ''})の観測値をもとに作成。雨は降水量1mm以上、晴れは日照4時間以上の日です。`
    : 'この期間の天気はまだ取れていません。毎朝5時すぎに前の日の天気を取ります。';
}

function Kpi({ label, value, unit, note }: { label: string; value: string; unit?: string; note?: string }) {
  return (
    <div className="kpi">
      <span className="l">{label}</span>
      <span className="v">
        {value}
        {unit && value !== '—' ? <small>{unit}</small> : null}
      </span>
      {note ? <span className="dash-kpi-note">{note}</span> : null}
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="panel dash-panel" aria-label={title}>
      <div className="dash-panel-head">
        <h2>{title}</h2>
        {note ? <p className="dash-note">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function line(label: string, values: (number | null)[], color: string, n: number, dashed = false) {
  return {
    label,
    data: values,
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    borderDash: dashed ? [5, 4] : undefined,
    pointRadius: n > 40 ? 0 : 3,
    pointHoverRadius: 4,
    tension: 0,
    spanGaps: false,
    // 上端(100% など)の点が半分に切れないように
    clip: 6,
  };
}
const legendOf = (c: ChartColors) => ({
  position: 'top' as const,
  align: 'start' as const,
  labels: { boxWidth: 12, boxHeight: 2, color: c.secondary, padding: 16 },
});

function Trend({ data }: { data: DashboardResponse }) {
  const [mode, setMode] = useState<'day' | 'month'>(data.days.length > 92 ? 'month' : 'day');
  const withYear = data.from.slice(0, 4) !== data.to.slice(0, 4);
  const labels = mode === 'day' ? data.days.map((d) => slashDate(d.date)) : data.months.map((m) => monthLabel(m.month, withYear));
  const dogs = mode === 'day' ? data.days.map((d) => (d.closed ? null : d.dogs)) : data.months.map((m) => m.dogs);
  const groups = mode === 'day' ? data.days.map((d) => (d.closed ? null : d.groups)) : data.months.map((m) => m.groups);
  const summary = `来場の推移(${mode === 'day' ? '日別' : '月別'})。合計 ${data.totals.dogs}頭・${data.totals.groups}組。`;
  return (
    <section className="panel dash-panel" aria-label="来場の推移">
      <div className="dash-panel-head dash-panel-head-row">
        <div>
          <h2>来場の推移</h2>
          <p className="dash-note">来場頭数(会員以外を含む)と来場組数です。臨時休業日は線を切っています。</p>
        </div>
        <div className="segment" role="tablist" aria-label="まとめ方">
          <button type="button" role="tab" aria-selected={mode === 'day'} onClick={() => setMode('day')}>
            日別
          </button>
          <button type="button" role="tab" aria-selected={mode === 'month'} onClick={() => setMode('month')}>
            月別
          </button>
        </div>
      </div>
      <DashChart
        height={260}
        label={summary}
        deps={[mode, data]}
        make={(c) => ({
          type: 'line',
          data: {
            labels,
            datasets: [line('来場頭数', dogs, c.accent, labels.length), line('来場組数', groups, c.tertiary, labels.length)],
          },
          options: {
            interaction: { mode: 'index', intersect: false },
            scales: {
              x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 12 } },
              y: { beginAtZero: true, ticks: { precision: 0 } },
            },
            plugins: { legend: legendOf(c) },
          },
        })}
      />
    </section>
  );
}

function RepeatChart({ data }: { data: DashboardResponse }) {
  const withYear = data.from.slice(0, 4) !== data.to.slice(0, 4);
  const months = data.repeat.months;
  if (months.every((m) => m.firstTimers === 0)) return <p className="empty">この期間に初めて来たおうちはありません。</p>;
  const labels = months.map((m) => monthLabel(m.month, withYear));
  return (
    <DashChart
      height={220}
      label={`リピート率。${months.map((m) => `${monthLabel(m.month, true)} ${pct(m.rate)}`).join('、')}`}
      deps={[data]}
      make={(c) => ({
        type: 'line',
        data: {
          labels,
          datasets: [
            line(
              'リピート率',
              months.map((m) => (m.rate === null ? null : Math.round(m.rate * 100))),
              c.accent,
              labels.length,
            ),
          ],
        },
        options: {
          scales: {
            x: { grid: { display: false }, ticks: { maxRotation: 0 } },
            y: { beginAtZero: true, max: 100, ticks: { callback: (v) => `${v}%` } },
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const m = months[ctx.dataIndex]!;
                  return [
                    `リピート率 ${pct(m.rate)}`,
                    `初めて ${m.firstTimers}軒・2回目 ${m.repeaters}軒`,
                    ...(m.pending ? [`判定待ち ${m.pending}軒`] : []),
                  ];
                },
              },
            },
          },
        },
      })}
    />
  );
}

function MonthlyChart({ data }: { data: DashboardResponse }) {
  const withYear = data.from.slice(0, 4) !== data.to.slice(0, 4);
  const labels = data.months.map((m) => monthLabel(m.month, withYear));
  return (
    <DashChart
      height={220}
      label={`新しいおうち ${data.totals.newHouseholds}軒、無料券の発行 ${data.totals.ticketsIssued}枚・利用 ${data.totals.ticketsUsed}枚。`}
      deps={[data]}
      make={(c) => ({
        type: 'line',
        data: {
          labels,
          datasets: [
            line('新しいおうち', data.months.map((m) => m.newHouseholds), c.accent, labels.length),
            line('無料券の発行', data.months.map((m) => m.ticketsIssued), c.secondary, labels.length),
            line('無料券の利用', data.months.map((m) => m.ticketsUsed), c.secondary, labels.length, true),
          ],
        },
        options: {
          interaction: { mode: 'index', intersect: false },
          scales: {
            x: { grid: { display: false }, ticks: { maxRotation: 0 } },
            y: { beginAtZero: true, ticks: { precision: 0 } },
          },
          plugins: { legend: legendOf(c) },
        },
      })}
    />
  );
}

/** 横棒グラフ(13章の「横棒グラフ」「棒グラフ」)。棒の右に値を書く */
function BarChart({
  bars,
  unit,
  label,
  limit,
  decimals = false,
}: {
  bars: Bar[];
  unit: string;
  label: string;
  limit?: number;
  decimals?: boolean;
}) {
  const shown = useMemo(() => {
    if (!limit || bars.length <= limit) return bars;
    const rest = bars.slice(limit).reduce((s, b) => s + b.count, 0);
    return [...bars.slice(0, limit), { label: 'そのほか', count: rest }];
  }, [bars, limit]);
  if (shown.every((b) => b.count === 0)) return <p className="empty">この期間の記録はまだありません。</p>;
  const fmt = (v: number) => `${decimals ? v.toFixed(1) : num(v)}${unit}`;
  const max = Math.max(...shown.map((b) => b.count));
  return (
    <DashChart
      height={shown.length * 30 + 16}
      label={`${label}。${shown.map((b) => `${b.label} ${fmt(b.count)}`).join('、')}`}
      deps={[shown]}
      make={(c) => ({
        type: 'bar',
        data: {
          labels: shown.map((b) => b.label),
          datasets: [{ label, data: shown.map((b) => b.count), backgroundColor: c.accent, borderRadius: 3, barThickness: 16 }],
        },
        options: {
          indexAxis: 'y',
          layout: { padding: { right: 56 } },
          scales: {
            x: { display: false, beginAtZero: true, suggestedMax: max * 1.05 },
            y: { grid: { display: false }, border: { display: false }, ticks: { color: c.text, autoSkip: false } },
          },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (ctx) => fmt(Number(ctx.raw)) } },
          },
        },
        plugins: [valueLabels(c.secondary, fmt)],
      })}
    />
  );
}

function ScatterChart({ data }: { data: DashboardResponse }) {
  const points = data.weather.points;
  if (points.length === 0) return <p className="empty">この期間の気温の記録はまだありません。</p>;
  return (
    <DashChart
      height={280}
      label={`最高気温と来場頭数の散布図。${points.length}日分。`}
      deps={[data]}
      make={(c) => ({
        type: 'scatter',
        data: {
          datasets: [
            {
              label: '1日',
              data: points.map((p) => ({ x: p.tempMax, y: p.dogs })),
              backgroundColor: c.accent,
              borderColor: c.accent,
              pointRadius: 4,
              pointHoverRadius: 5,
            },
          ],
        },
        options: {
          scales: {
            x: { title: { display: true, text: '最高気温(℃)', color: c.secondary }, grid: { display: false } },
            y: { title: { display: true, text: '来場頭数', color: c.secondary }, beginAtZero: true, ticks: { precision: 0 } },
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const p = points[ctx.dataIndex]!;
                  return `${mdw(p.date)} ${p.tempMax}℃ ${p.dogs}頭`;
                },
              },
            },
          },
        },
      })}
    />
  );
}

function EventsTable({ data }: { data: DashboardResponse }) {
  if (data.events.length === 0) {
    return <p className="empty">この期間のイベントはありません。イベントは「イベント・休業日」の画面で登録します。</p>;
  }
  return (
    <div className="dash-table-wrap">
      <table className="dash-table">
        <thead>
          <tr>
            <th scope="col">日付</th>
            <th scope="col">イベント</th>
            <th scope="col" className="n">
              頭数
            </th>
            <th scope="col" className="n">
              ふだんの平均
            </th>
            <th scope="col" className="n">
              差
            </th>
          </tr>
        </thead>
        <tbody>
          {data.events.map((e) => (
            <tr key={e.date}>
              <td>{mdw(e.date)}</td>
              <td>{e.names.join('・')}</td>
              <td className="n">{e.dogs}頭</td>
              <td className="n">{e.baseline === null ? '—' : `${e.baseline}頭`}</td>
              <td className="n">{e.diffPct === null ? '比べる日がありません' : `${e.diffPct > 0 ? '+' : ''}${e.diffPct}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CohortTable({ cohort }: { cohort: NonNullable<DashboardResponse['cohort']> }) {
  const rows = cohort.rows.filter((r) => r.size > 0);
  if (rows.length === 0) return <p className="empty">この期間に初めて来たおうちはありません。</p>;
  return (
    <div className="dash-table-wrap">
      <table className="dash-table dash-cohort">
        <thead>
          <tr>
            <th scope="col">初めて来た月</th>
            <th scope="col" className="n">
              おうち
            </th>
            {Array.from({ length: cohort.offsets }, (_, k) => (
              <th scope="col" className="n" key={k}>
                {k === 0 ? 'その月' : `${k}か月後`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month}>
              <th scope="row">{monthLabel(r.month, true)}</th>
              <td className="n">{r.size}軒</td>
              {r.active.map((n, k) => (
                <td className="n" key={k}>
                  {n === null ? '' : `${Math.round((n / r.size) * 100)}%`}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FamilyBlock({ family }: { family: NonNullable<DashboardResponse['family']> }) {
  if (family.households === 0) return <p className="empty">この期間に来場したおうちはありません。</p>;
  return (
    <div className="dash-kpis dash-kpis-3">
      <Kpi label="家族が2人以上のおうち" value={pct(family.rate)} note={`${family.multi}軒 / ${family.households}軒`} />
      <Kpi label="来場回数(2人以上)" value={family.avgVisitsMulti === null ? '—' : String(family.avgVisitsMulti)} unit="回" />
      <Kpi label="来場回数(1人)" value={family.avgVisitsSingle === null ? '—' : String(family.avgVisitsSingle)} unit="回" />
    </div>
  );
}

function DormantList({ dormant }: { dormant: NonNullable<DashboardResponse['dormant']> }) {
  if (dormant.households.length === 0) return <p className="empty">いまは、しばらく来ていない常連さんはいません。</p>;
  return (
    <ul className="dash-dormant" aria-label="しばらく来ていない常連さん">
      {dormant.households.map((h) => (
        <li key={h.id}>
          <Link to={`/households/${h.id}`} className="dash-dormant-row">
            <span className="stack">
              {h.dogs.map((d) => (
                <DogFace key={d.id} name={d.name} breedName={d.breedName} url={d.thumbUrl} size={44} />
              ))}
            </span>
            <span className="dash-dormant-body">
              <b>{h.dogs.map((d) => d.name).join('・') || h.displayName}</b>
              <span className="sub-text">
                {h.displayName}
                <span aria-hidden="true"> · </span>
                <span className="mono">{h.memberNo}</span>
              </span>
            </span>
            <span className="dash-dormant-meta">
              <span>{h.visits}回来場</span>
              <span className="sub-text">
                最後 {md(h.lastVisit)}({h.daysSince}日前)
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
