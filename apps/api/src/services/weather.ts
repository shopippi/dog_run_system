import { addDays, classifyWeather, toJstDate, toJstIso, type Settings, type WeatherKind } from '@dr/shared';
import type { JobOutcome } from './jobs';

// B-01 天気の取得。取得元は WeatherSource として差し替えられる(気象庁向けの実装は JmaAmedasSource)。
// 取得先の URL と項目の対応は docs/weather.md。

export type WeatherStation = Settings['weather_station'];

/** 1日分の天気 */
export type DailyWeather = {
  date: string;
  weather: WeatherKind | null;
  tempMax: number | null;
  tempMin: number | null;
  /** 1日の降水量(mm) */
  precipitation: number | null;
  /** 1日の日照時間(時間) */
  sunshineHours: number | null;
};

/** 天気の取得元 */
export interface WeatherSource {
  /** 出典として daily_weather.source に入れる名前 */
  readonly sourceName: string;
  /** その日の天気。まだ公開されていない・取れないときは理由つきで投げる */
  fetchDay(station: WeatherStation, date: string): Promise<DailyWeather>;
}

/** 1回の取得で取りに行く日数の上限(Workers の無料プランは1回の実行で外部へのリクエストが50件まで) */
export const WEATHER_MAX_DAYS_PER_RUN = 5;
/** 取れていない日を、何日前までさかのぼって取り直すか */
export const WEATHER_LOOKBACK_DAYS = 7;

type AmedasValue = [number | null, number | null] | undefined;
type AmedasObs = { temp?: AmedasValue; precipitation10m?: AmedasValue; sun10m?: AmedasValue };
type AmedasFile = Record<string, AmedasObs>;

/** 10分ごとの値が、1日(144回)のうち何回あれば1日分として使うか(2時間分の欠けまで許す) */
const MIN_RECORDS = 132;

const compact = (date: string) => date.replaceAll('-', '');
const num = (v: AmedasValue): number | null => (Array.isArray(v) && typeof v[0] === 'number' ? v[0] : null);
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * 気象庁「アメダス」の観測値(公開されている JSON)から、1日分の天気を作る。
 * https://www.jma.go.jp/bosai/amedas/data/point/<地点番号>/<YYYYMMDD>_<HH>.json
 * 1つのファイルに3時間分の10分ごとの観測値が入っている(HH = 00, 03, … 21)。
 * 気象庁の日の区切り(0時10分〜24時00分)に合わせ、翌日 00 時のファイルの 0:00 の値までを使う。
 * 最高・最低気温は10分ごとの気温の最大・最小、降水量は10分間降水量の合計、日照時間は10分間日照時間(分)の合計。
 */
export class JmaAmedasSource implements WeatherSource {
  readonly sourceName = '気象庁';
  /** 同じ実行の中で同じファイルを2回取らない(隣り合う日で翌日0時のファイルを共有する) */
  private cache = new Map<string, Promise<AmedasFile | null>>();

  constructor(private readonly baseUrl = 'https://www.jma.go.jp/bosai/amedas/data/point') {}

  private file(code: string, ymd: string, hh: string): Promise<AmedasFile | null> {
    const url = `${this.baseUrl}/${code}/${ymd}_${hh}.json`;
    let p = this.cache.get(url);
    if (!p) {
      p = (async () => {
        const res = await fetch(url, { headers: { 'user-agent': 'dog-run-system (weather)' } });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`気象庁のサイトから天気を受け取れませんでした(応答 ${res.status})`);
        return (await res.json()) as AmedasFile;
      })();
      this.cache.set(url, p);
    }
    return p;
  }

  async fetchDay(station: WeatherStation, date: string): Promise<DailyWeather> {
    const ymd = compact(date);
    const next = compact(addDays(date, 1));
    const files = await Promise.all([
      ...['00', '03', '06', '09', '12', '15', '18', '21'].map((hh) => this.file(station.code, ymd, hh)),
      this.file(station.code, next, '00'),
    ]);
    // その日の 0:10 〜 翌日 0:00 の観測
    const from = `${ymd}001000`;
    const to = `${next}000000`;
    const obs: AmedasObs[] = [];
    for (const f of files) {
      if (!f) continue;
      for (const [k, v] of Object.entries(f)) if (k >= from && k <= to) obs.push(v);
    }
    const temps = obs.map((o) => num(o.temp)).filter((n): n is number => n !== null);
    if (temps.length < MIN_RECORDS) {
      throw new Error(`${date} の観測値がまだそろっていません(${temps.length}/144)`);
    }
    const rains = obs.map((o) => num(o.precipitation10m)).filter((n): n is number => n !== null);
    const suns = obs.map((o) => num(o.sun10m)).filter((n): n is number => n !== null);
    const precipitation = rains.length >= MIN_RECORDS ? round1(rains.reduce((s, n) => s + n, 0)) : null;
    const sunshineHours = suns.length >= MIN_RECORDS ? round1(suns.reduce((s, n) => s + n, 0) / 60) : null;
    return {
      date,
      weather: classifyWeather({ precipitation, sunshineHours }),
      tempMax: Math.max(...temps),
      tempMin: Math.min(...temps),
      precipitation,
      sunshineHours,
    };
  }
}

/** 取れていない日(昨日から WEATHER_LOOKBACK_DAYS 日前まで)。新しい日から順に */
export async function missingWeatherDates(db: D1Database, now: Date): Promise<string[]> {
  const yesterday = addDays(toJstDate(now), -1);
  const oldest = addDays(yesterday, -(WEATHER_LOOKBACK_DAYS - 1));
  const { results } = await db
    .prepare('SELECT date FROM daily_weather WHERE date BETWEEN ? AND ?')
    .bind(oldest, yesterday)
    .all<{ date: string }>();
  const have = new Set(results.map((r) => r.date));
  const out: string[] = [];
  for (let d = yesterday; d >= oldest; d = addDays(d, -1)) if (!have.has(d)) out.push(d);
  return out;
}

/**
 * 前日の天気を取る(B-01。毎朝 5:10)。前日の分が無い・前に失敗した日があれば、過去7日分のうち無い日を取りに行く。
 * 結果は daily_weather に入れ、出典(source)に「気象庁」を入れる。
 */
export async function fetchWeather(
  db: D1Database,
  now: Date,
  station: WeatherStation,
  source: WeatherSource = new JmaAmedasSource(),
): Promise<JobOutcome> {
  const missing = await missingWeatherDates(db, now);
  if (missing.length === 0) return { message: '前日までの天気は、すでに取得済みです。' };
  const targets = missing.slice(0, WEATHER_MAX_DAYS_PER_RUN);
  const got: string[] = [];
  const failed: { date: string; reason: string }[] = [];
  const nowIso = toJstIso(now);
  for (const date of targets) {
    try {
      const w = await source.fetchDay(station, date);
      await db
        .prepare(
          `INSERT INTO daily_weather (date, weather, temp_max, temp_min, precipitation, sunshine_hours, station, source, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(date) DO UPDATE SET weather = excluded.weather, temp_max = excluded.temp_max,
             temp_min = excluded.temp_min, precipitation = excluded.precipitation, sunshine_hours = excluded.sunshine_hours,
             station = excluded.station, source = excluded.source, fetched_at = excluded.fetched_at`,
        )
        .bind(date, w.weather, w.tempMax, w.tempMin, w.precipitation, w.sunshineHours, station.name, source.sourceName, nowIso)
        .run();
      got.push(date);
    } catch (e) {
      failed.push({ date, reason: String((e as Error)?.message ?? e) });
    }
  }
  const left = missing.length - targets.length;
  const parts: string[] = [];
  if (got.length) parts.push(`${got.join('、')} の天気(${station.name})を取得しました。`);
  if (failed.length) {
    parts.push(`${failed.map((f) => f.date).join('、')} は取れませんでした(${failed[0]!.reason})。次の朝にもう一度取りに行きます。`);
  }
  if (left > 0) parts.push(`ほかに${left}日分が残っています。次の朝に続きを取ります。`);
  const message = parts.join('');
  if (got.length === 0) return { status: 'failed', message };
  if (failed.length || left > 0) return { status: 'warning', message };
  return { message };
}
