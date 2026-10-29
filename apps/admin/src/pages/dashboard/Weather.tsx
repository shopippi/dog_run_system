import { WEATHER_KINDS, type DashboardResponse, type WeatherVisitsRow } from '@dr/shared';
import { useState } from 'react';
import { DashChart } from '../../components/DashChart';
import { WeatherIcon } from '../../components/WeatherIcon';
import { dec, mdw } from './format';
import { Panel, Seg, type PanelCsv } from './parts';

// 天気と来場(docs/design.md 12.3)と、最高気温×来場の散布図

type Group = WeatherVisitsRow['dayGroup'];
const GROUPS: { value: Group; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'weekend', label: '土日祝' },
  { value: 'weekday', label: '平日' },
];
const GROUP_WORD: Record<Group, string> = { all: '', weekend: 'の土日祝', weekday: 'の平日' };

export function weatherNote(d: DashboardResponse) {
  return d.weather.source
    ? `${d.weather.source}のアメダス(${d.weather.station ?? ''})の観測値から。雨は降水量1mm以上、晴れは日照4時間以上の日です。`
    : 'この期間の天気はまだ取れていません。毎朝5時すぎに前の日の天気を取ります。';
}

export function WeatherVisitsPanel({ data }: { data: DashboardResponse }) {
  const [group, setGroup] = useState<Group>('all');
  const rows = WEATHER_KINDS.map((k) => data.weatherVisits.find((r) => r.kind === k && r.dayGroup === group)!).filter(Boolean);
  const max = Math.max(0.0001, ...rows.flatMap((r) => [r.avgMemberGroups ?? 0, r.avgWalkinDogs ?? 0]));
  const hasDays = rows.some((r) => r.days > 0);
  return (
    <Panel
      title="天気と来場"
      note={`天気ごとの、1日あたりの来場です。会員は来場組数、会員以外は頭数(会員以外は頭数だけを記録しているため)。${weatherNote(data)}`}
      actions={<Seg label="曜日" value={group} options={GROUPS} onChange={setGroup} />}
      csv={(): PanelCsv => ({
        unit: '天気と曜日のまとまりごとに1行',
        columns: [
          { name: '天気', desc: '晴れ / 曇り / 雨' },
          { name: '曜日', desc: 'すべて / 土日祝 / 平日' },
          { name: '日数(日)', desc: 'その天気だった営業日の数' },
          { name: '1日あたりの来場組数(組)', desc: '会員と会員以外の入力の合計の平均' },
          { name: '1日あたりの会員の来場組数(組)', desc: '会員のおうちの来場組数の平均' },
          { name: '1日あたりの会員以外の頭数(頭)', desc: '会員以外のワンちゃんの数の平均' },
          { name: '1日あたりの来場頭数(頭)', desc: 'ワンちゃんの数の平均' },
        ],
        rows: data.weatherVisits.map((r) => [r.kind, GROUPS.find((g) => g.value === r.dayGroup)!.label, r.days, r.avgGroups, r.avgMemberGroups, r.avgWalkinDogs, r.avgDogs]),
      })}
    >
      <ul className="dsb-legend" aria-label="グラフの見方">
        <li>
          <span className="dsb-sw solid" aria-hidden="true" />
          会員(組/日)
        </li>
        <li>
          <span className="dsb-sw solid c2" aria-hidden="true" />
          会員以外(頭/日)
        </li>
      </ul>
      {!hasDays ? (
        <p className="empty">この期間{GROUP_WORD[group]}の天気の記録はまだありません。</p>
      ) : (
        <ul className="dsb-wx" aria-label={`天気ごとの1日あたりの来場${GROUP_WORD[group]}`}>
          {rows.map((r) => (
            <li key={r.kind} className="dsb-wx-row">
              <span className="dsb-wx-kind">
                <WeatherIcon kind={r.kind} size={18} />
                <span>
                  <b>{r.kind}</b>
                  <span className="dsb-wx-days">
                    {r.kind}
                    {GROUP_WORD[group]} {r.days}日
                  </span>
                </span>
              </span>
              <span className="dsb-wx-bars">
                <span className="dsb-wx-bar">
                  <span className="dsb-wx-fill c1" style={{ width: `${((r.avgMemberGroups ?? 0) / max) * 100}%` }} aria-hidden="true" />
                  <span className="dsb-wx-val">会員 {dec(r.avgMemberGroups)}組</span>
                </span>
                <span className="dsb-wx-bar">
                  <span className="dsb-wx-fill c2" style={{ width: `${((r.avgWalkinDogs ?? 0) / max) * 100}%` }} aria-hidden="true" />
                  <span className="dsb-wx-val">会員以外 {dec(r.avgWalkinDogs)}頭</span>
                </span>
              </span>
              <span className="dsb-wx-total">
                <span className="dsb-wx-total-v">{dec(r.avgGroups)}</span>
                <span className="dsb-wx-total-l">組/日</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function ScatterPanel({ data }: { data: DashboardResponse }) {
  const types = new Map(data.days.map((d) => [d.date, d.dayType]));
  const points = data.weather.points;
  const weekend = points.filter((p) => types.get(p.date) && types.get(p.date) !== 'weekday');
  const weekday = points.filter((p) => !weekend.includes(p));
  return (
    <Panel
      title="最高気温と来場頭数"
      note="1つの点が1日です。暑い日・寒い日に来場がどう変わるかを見られます。"
      csv={(): PanelCsv => ({
        unit: '1日1行',
        columns: [
          { name: '日付', desc: '日本時間' },
          { name: '曜日区分', desc: '平日 / 土日祝' },
          { name: '最高気温(℃)', desc: 'アメダスの観測値' },
          { name: '来場頭数(頭)', desc: 'ワンちゃんの数(会員以外を含む)' },
        ],
        rows: points.map((p) => [p.date, weekend.includes(p) ? '土日祝' : '平日', p.tempMax, p.dogs]),
      })}
    >
      <ul className="dsb-legend" aria-label="グラフの見方">
        <li>
          <span className="dsb-sw dot" aria-hidden="true" />
          平日
        </li>
        <li>
          <span className="dsb-sw dot c3" aria-hidden="true" />
          土日祝
        </li>
      </ul>
      {points.length === 0 ? (
        <p className="empty">この期間の気温の記録はまだありません。</p>
      ) : (
        <DashChart
          height={260}
          label={`最高気温と来場頭数の散布図。${points.length}日分。`}
          deps={[data]}
          make={(c) => ({
            type: 'scatter',
            data: {
              datasets: [
                { label: '平日', data: weekday.map((p) => ({ x: p.tempMax, y: p.dogs })), backgroundColor: c.series[0], borderColor: c.series[0], pointRadius: 3.5, pointHoverRadius: 5 },
                { label: '土日祝', data: weekend.map((p) => ({ x: p.tempMax, y: p.dogs })), backgroundColor: c.series[2], borderColor: c.series[2], pointRadius: 3.5, pointHoverRadius: 5 },
              ],
            },
            options: {
              scales: {
                x: {
                  title: { display: true, text: '最高気温(℃)', color: c.tertiary },
                  grid: { color: c.border },
                  border: { display: false },
                  ticks: { color: c.tertiary },
                },
                y: {
                  title: { display: true, text: '来場頭数', color: c.tertiary },
                  beginAtZero: true,
                  grid: { color: c.border },
                  border: { display: false },
                  ticks: { precision: 0, color: c.tertiary },
                },
              },
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: (ctx) => {
                      const list = ctx.datasetIndex === 0 ? weekday : weekend;
                      const p = list[ctx.dataIndex]!;
                      return `${mdw(p.date)} ${p.tempMax}℃ ${p.dogs}頭`;
                    },
                  },
                },
              },
            },
          })}
        />
      )}
    </Panel>
  );
}
