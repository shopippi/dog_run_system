import {
  addDays,
  DASHBOARD_RANGE_LABELS,
  DASHBOARD_RANGES,
  toJstDate,
  topBars,
  type Bar,
  type DashboardRange,
  type DashboardResponse,
} from '@dr/shared';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DogFace } from '../components/DogFace';
import { ErrorNotice } from '../components/ErrorNotice';
import { PageHead } from '../components/PageHead';
import { Loading, Skeleton, SkeletonText, useDelayedFlag } from '../components/Skeleton';
import { useFacilityName } from '../hooks/useFacilityName';
import { adminApi } from '../lib/api';
import { AreasPanel } from './dashboard/Areas';
import { CalendarPanel } from './dashboard/Calendar';
import { dec, md, mdw, monthLabel, num, pct, periodLabel } from './dashboard/format';
import { BarTable, barsCsv, DashCtx, Panel, type PanelCsv } from './dashboard/parts';
import { KPI_KEYS, KpiCards, TrendPanel, type KpiKey } from './dashboard/Trend';
import { ScatterPanel, WeatherVisitsPanel } from './dashboard/Weather';
import '../dashboard.css';

// M-05 ダッシュボード(A-01)。指標の定義は要件定義書 13章、見た目は docs/design.md 12章(Cloudflare のダッシュボード風)。
// 並び: KPI のカード → 大きなグラフ → 天気と来場・カレンダー → 地域 → 内訳の表 → 継続・常連
// 期間は右上のセグメント。選んだ期間は URL の ?range= に残す(期間を選ぶときは ?from=&to= も)。

const isRange = (v: string | null): v is DashboardRange => !!v && (DASHBOARD_RANGES as readonly string[]).includes(v);
const isYmd = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function DashboardPage() {
  const today = toJstDate(new Date());
  const facilityName = useFacilityName();
  const [params, setParams] = useSearchParams();
  const range: DashboardRange = isRange(params.get('range')) ? (params.get('range') as DashboardRange) : '30d';
  const customFrom = isYmd(params.get('from')) ? params.get('from')! : addDays(today, -29);
  const customTo = isYmd(params.get('to')) ? params.get('to')! : today;
  const metricParam = params.get('metric');
  const metric: KpiKey = (KPI_KEYS as string[]).includes(metricParam ?? '') ? (metricParam as KpiKey) : 'groups';
  const query = range === 'custom' ? `range=custom&from=${customFrom}&to=${customTo}` : `range=${range}`;

  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // 期間を変えて読み直しているあいだ(120ms を過ぎたら)は、前の期間の数字ではなくスケルトンを出す
  const periodLate = useDelayedFlag(busy && !!data && loadedQuery !== query, 120);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (range === 'custom' && customFrom > customTo) return;
    let alive = true;
    setBusy(true);
    adminApi<DashboardResponse>(`/dashboard?${query}`)
      .then((r) => {
        if (!alive) return;
        setData(r);
        setLoadedQuery(query);
        setError(null);
      })
      .catch((e) => alive && setError(e))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [query, reloadKey, range, customFrom, customTo]);

  const fresh = data && loadedQuery === query ? data : null;

  return (
    <div className="page dsb-page">
      <PageHead
        title="ダッシュボード"
        howto="来場の数・前の期間との違い・天気や地域との関係を見られます。数字のカードを押すと、下のグラフが切り替わります。取り消した来場と臨時休業日は数えません。"
        aside={
          <div className="dsb-range" role="radiogroup" aria-label="期間">
            {DASHBOARD_RANGES.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={range === r}
                onClick={() => update(r === 'custom' ? { range: r, from: customFrom, to: customTo } : { range: r, from: null, to: null })}
              >
                {DASHBOARD_RANGE_LABELS[r]}
              </button>
            ))}
          </div>
        }
      />
      {range === 'custom' && (
        <div className="panel dsb-custom">
          <div className="field">
            <label htmlFor="dash-from">始まり</label>
            <input
              id="dash-from"
              type="date"
              value={customFrom}
              max={customTo}
              onChange={(e) => e.target.value && update({ from: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="dash-to">終わり</label>
            <input id="dash-to" type="date" value={customTo} min={customFrom} onChange={(e) => e.target.value && update({ to: e.target.value })} />
          </div>
        </div>
      )}
      <p className="dsb-period" role="status">
        {data ? periodLabel(data.from, data.to) : ''}
        {fresh ? <span className="dsb-period-sub">営業日 {fresh.totals.openDays}日</span> : null}
      </p>
      {error ? <ErrorNotice error={error} onRetry={() => setReloadKey((k) => k + 1)} /> : null}
      {!data ? (
        !error && <DashSkeleton />
      ) : periodLate && !error ? (
        <DashSkeleton delay={0} />
      ) : (
        <DashCtx.Provider value={{ facilityName, period: `${data.from}〜${data.to}`, from: data.from, to: data.to }}>
          <Body
            data={data}
            busy={busy}
            metric={metric}
            onMetric={(m) => update({ metric: m === 'groups' ? null : m })}
            reload={() => setReloadKey((k) => k + 1)}
          />
        </DashCtx.Provider>
      )}
    </div>
  );
}

/** 読み込み中: KPI のカード 6 枚・大きなグラフ・パネル */
function DashSkeleton({ delay }: { delay?: number }) {
  return (
    <Loading delay={delay}>
      <section className="panel dsb-kpis">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="dsb-kpi">
            <SkeletonText size={12} w={72} />
            <span className="sk-line" style={{ height: 36 }}>
              <Skeleton w={80} h={26} r={4} />
            </span>
            <SkeletonText size={12} w="70%" />
            <Skeleton h={32} r={4} />
          </div>
        ))}
      </section>
      <section className="panel dsb-panel dsb-wide">
        <div className="dsb-panel-head">
          <div className="dsb-panel-title">
            <SkeletonText size={14} w={140} />
            <SkeletonText size={13} w="60%" />
          </div>
        </div>
        <Skeleton h={300} r={8} />
      </section>
      <div className="dsb-grid">
        {[0, 1].map((i) => (
          <section key={i} className="panel dsb-panel">
            <SkeletonText size={14} w={120} />
            <Skeleton h={220} r={8} />
          </section>
        ))}
      </div>
    </Loading>
  );
}

function Body({
  data,
  busy,
  metric,
  onMetric,
  reload,
}: {
  data: DashboardResponse;
  busy: boolean;
  metric: KpiKey;
  onMetric: (m: KpiKey) => void;
  reload: () => void;
}) {
  const full = data.scope === 'full';
  const o = data.owners;
  const breakdown = (title: string, bars: Bar[], unit: string, desc: string, opts: { note?: string; keepOrder?: boolean; base?: number; item?: string } = {}) => {
    const shown = topBars(bars, 8, opts.keepOrder ?? true);
    return (
      <Panel key={title} title={title} note={opts.note} csv={() => barsCsv(shown, opts.item ?? title, unit, desc, opts.base)}>
        <BarTable bars={shown} unit={unit} label={title} base={opts.base} />
      </Panel>
    );
  };
  return (
    <div className="dsb" aria-busy={busy}>
      <KpiCards data={data} selected={metric} onSelect={onMetric} />
      <TrendPanel key={`${data.from}/${data.to}/${metric}`} data={data} metric={metric} />

      <div className="dsb-grid dsb-grid-2">
        <WeatherVisitsPanel data={data} />
        <ScatterPanel data={data} />
      </div>
      <CalendarPanel initialMonth={data.to.slice(0, 7)} today={data.today} onNotesChanged={reload} />

      <AreasPanel data={data} onLookedUp={reload} />

      <h2 className="dsb-section">内訳</h2>
      <div className="dsb-grid">
        {breakdown('来場頻度', data.frequency, '軒', '期間中に来た回数ごとのおうちの数', { note: '期間中に何回来たかごとの、おうちの数です。' })}
        <Panel
          title="曜日ごとの1日あたり"
          note="平日・土曜・日曜・祝日ごとの、1日あたりの来場頭数です。土日の祝日は土曜・日曜に入ります。"
          csv={(): PanelCsv => ({
            unit: '曜日区分ごとに1行',
            columns: [
              { name: '曜日区分', desc: '平日 / 土曜 / 日曜 / 祝日' },
              { name: '日数(日)', desc: '営業日の数' },
              { name: '1日あたりの来場頭数(頭)', desc: '平均' },
            ],
            rows: data.dayTypes.map((d) => [d.label, d.days, d.avgDogs]),
          })}
        >
          <BarTable
            bars={data.dayTypes.map((d) => ({ label: `${d.label}(${d.days}日)`, count: d.avgDogs ?? 0 }))}
            unit="頭"
            label="曜日ごとの1日あたりの来場頭数"
            decimals
            showPct={false}
          />
        </Panel>
        {breakdown('犬種', data.dogs.breeds, '頭', '期間中に来たワンちゃんの数', { note: `期間中に来たワンちゃん ${data.dogs.total}頭の、登録の犬種です。`, keepOrder: false })}
        {breakdown('サイズ', data.dogs.sizes, '頭', '期間中に来たワンちゃんの数')}
        {breakdown('年齢', data.dogs.ages, '頭', '期間中に来たワンちゃんの数', { note: '期間の終わりの日の年齢です。7歳からがシニアです。' })}
        {breakdown('ほかの犬との相性', data.dogs.sociability, '頭', '期間中に来たワンちゃんの数', { note: 'お客さんが登録した、ほかの犬との相性です。' })}
        {breakdown('飼い主の年代', o.ageGroups, '人', 'チェックインした家族の数', { note: `チェックインした家族 ${o.members}人です。` })}
        {breakdown('飼い主の性別', o.genders, '人', 'チェックインした家族の数')}
        {breakdown('知ったきっかけ', o.referrals, '軒', '来場したおうちの数', { note: `来場したおうち ${o.households}軒です。` })}
        {breakdown('ふだんの来場手段', o.transports, '軒', '来場したおうちの数')}
        {breakdown('来たい時間帯', o.preferredTimes, '軒', '選んだおうちの数', { note: 'いくつでも選べる質問です。割合は来場したおうちに対する割合です。', base: o.households })}
        {breakdown('興味のあるイベント', o.eventInterests, '軒', '選んだおうちの数', { note: 'いくつでも選べる質問です。割合は来場したおうちに対する割合です。', base: o.households })}
        {breakdown('ほかのドッグランの利用', o.otherRuns, '軒', '来場したおうちの数')}
        <TicketsPanel data={data} />
        {full && data.family && <FamilyPanel family={data.family} />}
        {full &&
          data.surveys?.map((s) =>
            s.kind === 'choice' ? (
              breakdown(s.label, s.answers, '件', '回答の数', { note: `追加したアンケート。これまでに${s.answered}件の回答${s.visible ? '' : '(いまは聞いていない質問)'}です。` })
            ) : (
              <Panel key={s.id} title={s.label} note={`追加したアンケート(自由に書く質問)。これまでに${s.answered}件の回答です。`}>
                {s.recentTexts.length === 0 ? (
                  <p className="empty">まだ回答はありません。</p>
                ) : (
                  <ul className="dsb-texts" aria-label={`${s.label}の新しい回答`}>
                    {s.recentTexts.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                )}
              </Panel>
            ),
          )}
      </div>

      <div className="dsb-grid dsb-grid-2">
        <RepeatPanel data={data} />
        <EventsPanel data={data} />
      </div>

      {full && data.cohort && (
        <>
          <h2 className="dsb-section">継続と常連さん</h2>
          <CohortPanel cohort={data.cohort} />
        </>
      )}
      {full && data.dormant && <DormantPanel data={data} />}
    </div>
  );
}

function TicketsPanel({ data }: { data: DashboardResponse }) {
  const t = data.totals;
  return (
    <Panel
      title="無料券の発行と利用"
      note="期間中に発行した無料券(ポイントとの交換など)と、使われた無料券です。"
      csv={(): PanelCsv => ({
        unit: '月ごとに1行',
        columns: [
          { name: '月', desc: '年-月' },
          { name: '無料券の発行(枚)', desc: '発行した無料券' },
          { name: '無料券の使用(枚)', desc: '使われた無料券' },
          { name: '新しいおうち(軒)', desc: '会員IDを発行したおうち' },
        ],
        rows: data.months.map((m) => [m.month, m.ticketsIssued, m.ticketsUsed, m.newHouseholds]),
      })}
    >
      <div className="dsb-nums">
        <div>
          <span className="l">発行</span>
          <span className="v">
            {num(t.ticketsIssued)}
            <small>枚</small>
          </span>
        </div>
        <div>
          <span className="l">使用</span>
          <span className="v">
            {num(t.ticketsUsed)}
            <small>枚</small>
          </span>
        </div>
        <div>
          <span className="l">利用率</span>
          <span className="v">{pct(t.ticketUseRate)}</span>
        </div>
      </div>
    </Panel>
  );
}

function FamilyPanel({ family }: { family: NonNullable<DashboardResponse['family']> }) {
  return (
    <Panel
      title="家族での利用"
      note="期間中に来場したおうちのうち、LINEでつながっている家族が2人以上のおうちです。"
      csv={(): PanelCsv => ({
        unit: '1行',
        columns: [
          { name: '来場したおうち(軒)', desc: '期間中に来場したおうち' },
          { name: '家族が2人以上のおうち(軒)', desc: 'LINEでつながっている家族が2人以上' },
          { name: '割合(%)', desc: '家族が2人以上のおうち ÷ 来場したおうち' },
          { name: '来場回数・2人以上(回)', desc: '1おうちあたりの期間中の来場回数' },
          { name: '来場回数・1人(回)', desc: '1おうちあたりの期間中の来場回数' },
        ],
        rows: [[family.households, family.multi, family.rate === null ? '' : Math.round(family.rate * 1000) / 10, family.avgVisitsMulti, family.avgVisitsSingle]],
      })}
    >
      {family.households === 0 ? (
        <p className="empty">この期間に来場したおうちはありません。</p>
      ) : (
        <div className="dsb-nums">
          <div>
            <span className="l">家族が2人以上</span>
            <span className="v">{pct(family.rate)}</span>
            <span className="s">
              {family.multi}軒 / {family.households}軒
            </span>
          </div>
          <div>
            <span className="l">来場回数(2人以上)</span>
            <span className="v">
              {dec(family.avgVisitsMulti)}
              <small>回</small>
            </span>
          </div>
          <div>
            <span className="l">来場回数(1人)</span>
            <span className="v">
              {dec(family.avgVisitsSingle)}
              <small>回</small>
            </span>
          </div>
        </div>
      )}
    </Panel>
  );
}

function RepeatPanel({ data }: { data: DashboardResponse }) {
  const months = data.repeat.months.filter((m) => m.firstTimers > 0);
  const withYear = data.from.slice(0, 4) !== data.to.slice(0, 4);
  return (
    <Panel
      title="リピート率(初めて来た月ごと)"
      note={`期間中に初めて来たおうち ${data.repeat.firstTimers}軒のうち、${data.settings.repeatDays}日以内に2回目に来たおうちの割合です。`}
      csv={(): PanelCsv => ({
        unit: '初めて来た月ごとに1行',
        columns: [
          { name: '初めて来た月', desc: '年-月' },
          { name: '初めて来たおうち(軒)', desc: 'その月に初めて来場したおうち' },
          { name: '2回目に来たおうち(軒)', desc: `${data.settings.repeatDays}日以内に2回目に来たおうち` },
          { name: '判定待ち(軒)', desc: `まだ${data.settings.repeatDays}日たっていないおうち` },
          { name: 'リピート率(%)', desc: '2回目に来たおうち ÷ 初めて来たおうち' },
        ],
        rows: data.repeat.months.map((m) => [m.month, m.firstTimers, m.repeaters, m.pending, m.rate === null ? '' : Math.round(m.rate * 1000) / 10]),
      })}
    >
      {months.length === 0 ? (
        <p className="empty">この期間に初めて来たおうちはありません。</p>
      ) : (
        <div className="dsb-table-wrap">
          <table className="dsb-table">
            <thead>
              <tr>
                <th scope="col">初めて来た月</th>
                <th scope="col" className="n">
                  初めて
                </th>
                <th scope="col" className="n">
                  2回目
                </th>
                <th scope="col" className="n">
                  判定待ち
                </th>
                <th scope="col" className="n">
                  リピート率
                </th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month}>
                  <th scope="row">{monthLabel(m.month, withYear)}</th>
                  <td className="n">{m.firstTimers}軒</td>
                  <td className="n">{m.repeaters}軒</td>
                  <td className="n">{m.pending ? `${m.pending}軒` : '—'}</td>
                  <td className="n">{pct(m.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function EventsPanel({ data }: { data: DashboardResponse }) {
  return (
    <Panel
      title="イベントの効果"
      note="イベントの日の頭数を、同じ月・同じ曜日区分のイベントのない日の平均と比べています。"
      csv={(): PanelCsv => ({
        unit: 'イベントの日ごとに1行',
        columns: [
          { name: '日付', desc: '日本時間' },
          { name: 'イベント', desc: 'イベントの名前' },
          { name: '来場頭数(頭)', desc: 'その日のワンちゃんの数' },
          { name: 'ふだんの平均(頭)', desc: '同じ月・同じ曜日区分のイベントのない日の平均' },
          { name: '差(%)', desc: '(来場頭数 − ふだんの平均)÷ ふだんの平均' },
        ],
        rows: data.events.map((e) => [e.date, e.names.join(' / '), e.dogs, e.baseline, e.diffPct]),
      })}
    >
      {data.events.length === 0 ? (
        <p className="empty">この期間のイベントはありません。イベントは「イベント・休業日」の画面で登録します。</p>
      ) : (
        <div className="dsb-table-wrap">
          <table className="dsb-table">
            <thead>
              <tr>
                <th scope="col">日付</th>
                <th scope="col">イベント</th>
                <th scope="col" className="n">
                  頭数
                </th>
                <th scope="col" className="n">
                  ふだん
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
                  <td className="wrap">{e.names.join('・')}</td>
                  <td className="n">{e.dogs}頭</td>
                  <td className="n">{e.baseline === null ? '—' : `${e.baseline}頭`}</td>
                  <td className="n">{e.diffPct === null ? '—' : `${e.diffPct > 0 ? '+' : ''}${e.diffPct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function CohortPanel({ cohort }: { cohort: NonNullable<DashboardResponse['cohort']> }) {
  const rows = cohort.rows.filter((r) => r.size > 0);
  return (
    <Panel
      title="おうちの継続状況"
      note="期間中に初めて来たおうちを、初めて来た月ごとにまとめ、その後の各月にも来たおうちの割合を出しています。"
      wide
      csv={(): PanelCsv => ({
        unit: '初めて来た月ごとに1行',
        columns: [
          { name: '初めて来た月', desc: '年-月' },
          { name: 'おうち(軒)', desc: 'その月に初めて来たおうち' },
          ...Array.from({ length: cohort.offsets }, (_, k) => ({ name: `${k === 0 ? 'その月' : `${k}か月後`}(%)`, desc: 'その月にも来たおうちの割合' })),
        ],
        rows: rows.map((r) => [r.month, r.size, ...r.active.map((n) => (n === null ? '' : Math.round((n / r.size) * 1000) / 10))]),
      })}
    >
      {rows.length === 0 ? (
        <p className="empty">この期間に初めて来たおうちはありません。</p>
      ) : (
        <div className="dsb-table-wrap">
          <table className="dsb-table dsb-cohort">
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
                  {r.active.map((n, k) => {
                    const rate = n === null ? null : n / r.size;
                    const lv = rate === null || rate === 0 ? 0 : Math.min(5, Math.ceil(rate * 5));
                    return (
                      <td className={`n dsb-heat-cell lv${lv}`} key={k}>
                        {rate === null ? '' : `${Math.round(rate * 100)}%`}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function DormantPanel({ data }: { data: DashboardResponse }) {
  const d = data.dormant!;
  return (
    <Panel
      title="しばらく来ていない常連さん"
      wide
      note={`これまでに${data.settings.dormantMinVisits}回以上来て、${data.settings.dormantDays}日以上来ていないおうちです(今日の時点)。${
        d.total > d.households.length ? `全${d.total}軒のうち、来場の多い${d.households.length}軒を出しています。` : ''
      }`}
    >
      {d.households.length === 0 ? (
        <p className="empty">いまは、しばらく来ていない常連さんはいません。</p>
      ) : (
        <ul className="dsb-dormant" aria-label="しばらく来ていない常連さん">
          {d.households.map((h) => (
            <li key={h.id}>
              <Link to={`/households/${h.id}`} className="dsb-dormant-row">
                <span className="stack">
                  {h.dogs.map((x) => (
                    <DogFace key={x.id} name={x.name} breedName={x.breedName} url={x.thumbUrl} size={40} />
                  ))}
                </span>
                <span className="dsb-dormant-body">
                  <b>{h.dogs.map((x) => x.name).join('・') || h.displayName}</b>
                  <span className="sub-text">
                    {h.displayName}
                    <span aria-hidden="true"> · </span>
                    <span className="mono">{h.memberNo}</span>
                  </span>
                </span>
                <span className="dsb-dormant-meta">
                  <span>{h.visits}回来場</span>
                  <span className="sub-text">
                    最後 {md(h.lastVisit)}({h.daysSince}日前)
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
