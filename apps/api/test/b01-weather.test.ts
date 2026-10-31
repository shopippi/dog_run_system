import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runScheduled } from '../src/cron';

// 気象庁のアメダスの JSON の偽物。日ごとに、気温の基準・10分間降水量・10分間日照(分)を決める。
// 気温は「基準 + 時」(0:10 は基準、23:50 は基準 + 23)。
type DayConf = { base: number; rain: number; sun: number };

function amedasFile(ymd: string, hh: string, conf: DayConf) {
  const out: Record<string, unknown> = {};
  const start = Number(hh);
  for (let h = start; h < start + 3; h++) {
    for (let m = 0; m < 60; m += 10) {
      const key = `${ymd}${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}00`;
      out[key] = {
        prefNumber: 44,
        observationNumber: 132,
        temp: [conf.base + h, 0],
        humidity: [60, 0],
        precipitation10m: [conf.rain, 0],
        precipitation1h: [conf.rain * 6, 0],
        sun10m: [conf.sun, 0],
        sun1h: [(conf.sun * 6) / 60, 0],
      };
    }
  }
  return out;
}

function mockJma(days: Record<string, DayConf | 'error'>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const m = url.match(/^https:\/\/www\.jma\.go\.jp\/bosai\/amedas\/data\/point\/(\d{5})\/(\d{4})(\d{2})(\d{2})_(\d{2})\.json$/);
    if (!m) return new Response('not found', { status: 404 });
    const date = `${m[2]}-${m[3]}-${m[4]}`;
    const conf = days[date];
    if (conf === 'error') return new Response('busy', { status: 500 });
    if (!conf) return new Response('not found', { status: 404 });
    return Response.json(amedasFile(`${m[2]}${m[3]}${m[4]}`, m[5]!, conf));
  });
}

const morning = (jstDate: string) => runScheduled('10 20 * * *', env, new Date(`${jstDate}T05:10:00+09:00`));
const weatherRow = (date: string) =>
  env.DB.prepare(
    'SELECT weather, temp_max, temp_min, precipitation, sunshine_hours, station, source FROM daily_weather WHERE date = ?',
  )
    .bind(date)
    .first();
const lastJob = () =>
  env.DB.prepare("SELECT status, message FROM system_jobs WHERE name = 'weather' ORDER BY id DESC").first<{ status: string; message: string }>();
async function haveWeather(...dates: string[]) {
  for (const d of dates) {
    await env.DB.prepare("INSERT INTO daily_weather (date, weather, station, source, fetched_at) VALUES (?, '晴れ', '東京', '気象庁', 'x')")
      .bind(d)
      .run();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('B-01 天気の取得', () => {
  it('毎朝 5:10 に前日の天気・最高気温・最低気温・降水量を取り、出典に「気象庁」を入れる', async () => {
    await haveWeather('2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26');
    const spy = mockJma({ '2026-10-27': { base: 10, rain: 0, sun: 2 }, '2026-10-28': { base: 12, rain: 0, sun: 2 } });
    await morning('2026-10-28');
    // 3時間ごとのファイル8つと、翌日0時のファイル(0:00 の値は前日に入る)
    expect(spy).toHaveBeenCalledTimes(9);
    expect(spy.mock.calls.map((c) => String(c[0]))).toContain('https://www.jma.go.jp/bosai/amedas/data/point/63461/20261027_21.json');
    // 気温は 0:10 の 10.0 から 23:50 の 33.0 まで。翌日 0:00 は 12.0。
    // 日照は 2分 × 144 = 288分 = 4.8時間 → 晴れ
    expect(await weatherRow('2026-10-27')).toEqual({
      weather: '晴れ',
      temp_max: 33,
      temp_min: 10,
      precipitation: 0,
      sunshine_hours: 4.8,
      station: '三木',
      source: '気象庁',
    });
    expect(await lastJob()).toMatchObject({ status: 'ok' });
  });

  it('降水量 1.0mm 以上は雨、日照が短い日は曇り', async () => {
    await haveWeather('2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25');
    mockJma({
      '2026-10-26': { base: 5, rain: 0, sun: 1 },
      '2026-10-27': { base: 8, rain: 0.5, sun: 3 },
      '2026-10-28': { base: 8, rain: 0, sun: 0 },
    });
    await morning('2026-10-28');
    // 10/26: 日照 1分 × 143 + 翌日0:00 の 0.5mm の日の 3分 = 146分 ≒ 2.4時間 → 曇り(雨は翌日0:00 の 0.5mm だけ)
    expect(await weatherRow('2026-10-26')).toMatchObject({ weather: '曇り', precipitation: 0.5 });
    // 10/27: 0.5mm × 143 = 71.5mm → 雨
    expect(await weatherRow('2026-10-27')).toMatchObject({ weather: '雨', precipitation: 71.5 });
  });

  it('取れなかったら失敗を記録し、翌朝に前日の分と一緒に取り直す', async () => {
    await haveWeather('2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26');
    const failing = mockJma({ '2026-10-27': 'error' });
    await morning('2026-10-28');
    expect(await weatherRow('2026-10-27')).toBeNull();
    expect(await lastJob()).toMatchObject({ status: 'failed' });
    expect((await lastJob())!.message).toContain('次の朝にもう一度取りに行きます');
    failing.mockRestore();

    mockJma({
      '2026-10-27': { base: 10, rain: 0, sun: 2 },
      '2026-10-28': { base: 10, rain: 0, sun: 2 },
      '2026-10-29': { base: 10, rain: 0, sun: 2 },
    });
    await morning('2026-10-29');
    expect(await weatherRow('2026-10-28')).not.toBeNull();
    expect(await weatherRow('2026-10-27')).not.toBeNull();
    expect(await lastJob()).toMatchObject({ status: 'ok' });
  });

  it('観測値がまだそろっていない日(ファイルが無い)は取らずに、次の朝に回す', async () => {
    await haveWeather('2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25');
    mockJma({ '2026-10-26': { base: 10, rain: 0, sun: 2 }, '2026-10-27': { base: 10, rain: 0, sun: 2 } }); // 10/28 0時のファイルが無い
    await morning('2026-10-28');
    expect(await weatherRow('2026-10-26')).not.toBeNull();
    // 10/27 は 0:10〜23:50 の 143 回分あるので、1日分として使える
    expect(await weatherRow('2026-10-27')).not.toBeNull();
  });

  it('過去7日分のうち無い日を取りに行く。1回に取るのは5日分まで(新しい日から)', async () => {
    const days: Record<string, DayConf> = {};
    for (let d = 20; d <= 28; d++) days[`2026-10-${d}`] = { base: 10, rain: 0, sun: 2 };
    const spy = mockJma(days);
    await morning('2026-10-28');
    const { results } = await env.DB.prepare('SELECT date FROM daily_weather ORDER BY date').all<{ date: string }>();
    expect(results.map((r) => r.date)).toEqual(['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
    // 隣り合う日の翌日0時のファイルは1回だけ取る(5日 × 8 + 1)
    expect(spy).toHaveBeenCalledTimes(41);
    expect(await lastJob()).toMatchObject({ status: 'warning' });
    expect((await lastJob())!.message).toContain('ほかに2日分');
  });

  it('観測地点は設定(weather_station)で変えられる', async () => {
    await env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('weather_station', '{"code":"62078","name":"大阪"}', 'x')`,
    ).run();
    await haveWeather('2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26');
    const spy = mockJma({ '2026-10-27': { base: 10, rain: 0, sun: 2 }, '2026-10-28': { base: 10, rain: 0, sun: 2 } });
    await morning('2026-10-28');
    expect(String(spy.mock.calls[0]![0])).toContain('/point/62078/');
    expect(await weatherRow('2026-10-27')).toMatchObject({ station: '大阪' });
  });

  it('すでに取れていれば、何も取りに行かない', async () => {
    await haveWeather('2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27');
    const spy = mockJma({});
    await morning('2026-10-28');
    expect(spy).not.toHaveBeenCalled();
    expect(await lastJob()).toMatchObject({ status: 'ok' });
  });
});
