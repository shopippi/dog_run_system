import { describe, expect, it } from 'vitest';
import {
  addHourKey,
  bucketDays,
  bucketRanges,
  csvCommentLine,
  csvPreamble,
  diffPct,
  firstLine,
  granularityOf,
  normalizePostal,
  parseZipcloud,
  previousPeriod,
  resolveRange,
  topBars,
  toCsv,
  weatherVisits,
  type DayValues,
} from '../src';

// ダッシュボードの作り直し(docs/design.md 12章)のロジック
describe('期間と区切り', () => {
  const today = '2026-10-29';
  it('期間の切り替えから日付の期間を決める', () => {
    expect(resolveRange('24h', today)).toEqual({ from: '2026-10-28', to: today });
    expect(resolveRange('7d', today)).toEqual({ from: '2026-10-23', to: today });
    expect(resolveRange('30d', today)).toEqual({ from: '2026-09-30', to: today });
    expect(resolveRange('90d', today)).toEqual({ from: '2026-08-01', to: today });
    expect(resolveRange('12m', today)).toEqual({ from: '2025-10-30', to: today });
    expect(resolveRange('custom', today, { from: '2026-01-01', to: '2026-01-31' })).toEqual({ from: '2026-01-01', to: '2026-01-31' });
  });

  it('前の期間は同じ長さで、すぐ前(月をまたぐ・うるう年)', () => {
    expect(previousPeriod('2026-10-23', '2026-10-29')).toEqual({ from: '2026-10-16', to: '2026-10-22' });
    expect(previousPeriod('2026-03-01', '2026-03-31')).toEqual({ from: '2026-01-29', to: '2026-02-28' });
    expect(previousPeriod('2028-03-01', '2028-03-01')).toEqual({ from: '2028-02-29', to: '2028-02-29' });
  });

  it('横軸のまとめ方(時・日・週・月)', () => {
    expect(granularityOf('24h', '2026-10-28', today)).toBe('hour');
    expect(granularityOf('custom', '2026-07-30', today)).toBe('day'); // 92日
    expect(granularityOf('custom', '2026-07-29', today)).toBe('week'); // 92日を超える
    expect(granularityOf('12m', '2025-10-30', today)).toBe('week');
    expect(granularityOf('custom', '2025-09-01', today)).toBe('month');
  });

  it('週は始まりから7日ずつ(最後は短い)、月は暦の月で期間に合わせて切る', () => {
    expect(bucketRanges('2026-10-01', '2026-10-10', 'week')).toEqual([
      { start: '2026-10-01', end: '2026-10-07' },
      { start: '2026-10-08', end: '2026-10-10' },
    ]);
    expect(bucketRanges('2026-01-15', '2026-03-03', 'month')).toEqual([
      { start: '2026-01-15', end: '2026-01-31' },
      { start: '2026-02-01', end: '2026-02-28' },
      { start: '2026-03-01', end: '2026-03-03' },
    ]);
    expect(bucketRanges('2026-10-02', '2026-10-01', 'day')).toEqual([]);
  });

  it('1日ごとの値を区切りごとに合計する。メモとイベントも集める', () => {
    const day = (date: string, groups: number, extra: Partial<DayValues> = {}): DayValues => ({
      date, groups, memberGroups: groups, dogs: groups * 2, dogsMember: groups * 2, dogsWalkin: 0, newHouseholds: 0, ticketsUsed: 0,
      notes: [], events: [], weather: null, tempMax: null, closed: false, ...extra,
    });
    const days = [day('2026-10-01', 2, { notes: ['雨'] }), day('2026-10-03', 1, { events: ['教室'] }), day('2026-10-09', 4)];
    const weeks = bucketDays(days, '2026-10-01', '2026-10-10', 'week');
    expect(weeks.map((b) => [b.start, b.groups, b.dogs, b.notes, b.events])).toEqual([
      ['2026-10-01', 3, 6, ['雨'], ['教室']],
      ['2026-10-08', 4, 8, [], []],
    ]);
    const daily = bucketDays([day('2026-10-01', 1, { weather: '晴れ', tempMax: 20 })], '2026-10-01', '2026-10-02', 'day');
    expect(daily[0]).toMatchObject({ weather: '晴れ', tempMax: 20 });
    expect(daily[1]).toMatchObject({ groups: 0, weather: null });
  });

  it('時刻をずらす(日をまたぐ)', () => {
    expect(addHourKey('2026-10-29T12', -23)).toBe('2026-10-28T13');
    expect(addHourKey('2026-10-31T23', 1)).toBe('2026-11-01T00');
  });

  it('前の期間との差(%)。前が 0 なら比べられない', () => {
    expect(diffPct(112, 100)).toBe(12);
    expect(diffPct(97, 100)).toBe(-3);
    expect(diffPct(5, 0)).toBeNull();
  });
});

describe('天気と来場', () => {
  it('天気ごと・土日祝/平日ごとの1日あたり。営業日だけ、天気のない日は入れない', () => {
    const rows = weatherVisits([
      { open: true, weather: '晴れ', dayType: 'saturday', groups: 10, memberGroups: 8, dogs: 14, dogsWalkin: 3 },
      { open: true, weather: '晴れ', dayType: 'holiday', groups: 6, memberGroups: 6, dogs: 8, dogsWalkin: 0 },
      { open: true, weather: '晴れ', dayType: 'weekday', groups: 3, memberGroups: 2, dogs: 4, dogsWalkin: 1 },
      { open: false, weather: '晴れ', dayType: 'weekday', groups: 0, memberGroups: 0, dogs: 0, dogsWalkin: 0 },
      { open: true, weather: null, dayType: 'weekday', groups: 9, memberGroups: 9, dogs: 9, dogsWalkin: 0 },
      { open: true, weather: '雨', dayType: 'sunday', groups: 1, memberGroups: 1, dogs: 1, dogsWalkin: 0 },
    ]);
    const find = (kind: string, g: string) => rows.find((r) => r.kind === kind && r.dayGroup === g)!;
    expect(find('晴れ', 'all')).toEqual({ kind: '晴れ', dayGroup: 'all', days: 3, avgGroups: 6.3, avgMemberGroups: 5.3, avgWalkinDogs: 1.3, avgDogs: 8.7 });
    expect(find('晴れ', 'weekend')).toMatchObject({ days: 2, avgGroups: 8, avgMemberGroups: 7 });
    expect(find('晴れ', 'weekday')).toMatchObject({ days: 1, avgGroups: 3 });
    expect(find('雨', 'weekday')).toMatchObject({ days: 0, avgGroups: null });
    expect(find('曇り', 'all').days).toBe(0);
    expect(rows).toHaveLength(9);
  });
});

describe('郵便番号', () => {
  it('7桁の数字にそろえる', () => {
    expect(normalizePostal('154-0001')).toBe('1540001');
    expect(normalizePostal('〒１５４－０００１')).toBe('1540001');
    expect(normalizePostal('15400')).toBeNull();
    expect(normalizePostal(null)).toBeNull();
  });
  it('zipcloud の応答を読む', () => {
    expect(parseZipcloud({ status: 200, message: null, results: [{ address1: '千葉県', address2: '船橋市', address3: '本町' }] })).toEqual({
      prefecture: '千葉県',
      city: '船橋市',
      town: '本町',
    });
    expect(parseZipcloud({ status: 200, message: null, results: null })).toBeNull();
    expect(() => parseZipcloud({ status: 400, message: '必須パラメータが指定されていません。' })).toThrow();
    expect(() => parseZipcloud('<html>')).toThrow();
  });
});

describe('内訳の表・メモ・CSV の説明行', () => {
  it('上位8件 + そのほか + 未回答', () => {
    const bars = Array.from({ length: 11 }, (_, i) => ({ label: `犬種${i}`, count: 20 - i }));
    const out = topBars([...bars, { label: '未回答', count: 3 }]);
    expect(out.map((b) => b.label)).toEqual(['犬種0', '犬種1', '犬種2', '犬種3', '犬種4', '犬種5', '犬種6', '犬種7', 'そのほか', '未回答']);
    expect(out[8]!.count).toBe(12 + 11 + 10);
    // 決まった順(サイズなど)は、少なければそのまま
    expect(topBars([{ label: '小型', count: 1 }, { label: '大型', count: 5 }], 8, true).map((b) => b.label)).toEqual(['小型', '大型']);
  });
  it('メモの1行目', () => {
    expect(firstLine('\n午後から雨。\n小型犬の集まり')).toBe('午後から雨。');
    expect(firstLine('あ'.repeat(50), 10)).toBe(`${'あ'.repeat(10)}…`);
  });
  it('説明行はいつも # で始まり、半角のカンマ・引用符・改行を含まない', () => {
    expect(csvCommentLine('施設, "名前"\n2行目')).toBe('# 施設、 ”名前” 2行目');
    const pre = csvPreamble({
      title: '分析パック',
      facilityName: 'グリーンドーム',
      exportedAt: '2026-10-29T10:05:00+09:00',
      period: '2026-10-01〜2026-10-29',
      unit: '1日1行',
      columns: [{ name: '来場組数(組)', desc: 'チェックインの件数' }],
      notes: ['個人を特定できる情報は入っていません。'],
      usage: ['AIに渡してください。'],
    });
    const csv = toCsv(['日付', '来場組数(組)'], [['2026-10-01', 3]], pre);
    const lines = csv.slice(1).split('\r\n');
    expect(csv.startsWith('﻿# グリーンドーム 分析パック')).toBe(true);
    expect(lines).toContain('# 出力した日時: 2026-10-29 10:05(日本時間)');
    expect(lines).toContain('# - 来場組数(組) = チェックインの件数');
    expect(lines.slice(-3)).toEqual(['日付,来場組数(組)', '2026-10-01,3', '']);
    expect(toCsv(['a'], [[1]])).toBe('﻿a\r\n1\r\n');
  });
});
