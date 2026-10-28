import { describe, expect, it } from 'vitest';
import { classifyWeather, dayTypeOf } from '../src';

describe('曜日区分(calendar.day_type)', () => {
  it('平日・土曜・日曜。平日の祝日だけを「祝日」にする', () => {
    expect(dayTypeOf('2026-10-28', null)).toBe('weekday'); // 水
    expect(dayTypeOf('2026-10-31', null)).toBe('saturday');
    expect(dayTypeOf('2026-11-01', null)).toBe('sunday');
    expect(dayTypeOf('2026-11-03', '文化の日')).toBe('holiday'); // 火
    expect(dayTypeOf('2027-05-03', '憲法記念日')).toBe('holiday'); // 月
    expect(dayTypeOf('2026-05-03', '憲法記念日')).toBe('sunday'); // 日曜の祝日は日曜
  });
});

describe('B-01 天気の判定', () => {
  it('降水量 1.0mm 以上は雨(日照に関係なく)', () => {
    expect(classifyWeather({ precipitation: 1.0, sunshineHours: 8 })).toBe('雨');
    expect(classifyWeather({ precipitation: 12.5, sunshineHours: null })).toBe('雨');
  });
  it('降水量 1.0mm 未満で日照 4時間以上は晴れ、4時間未満は曇り(境界値)', () => {
    expect(classifyWeather({ precipitation: 0.9, sunshineHours: 4.0 })).toBe('晴れ');
    expect(classifyWeather({ precipitation: 0, sunshineHours: 3.9 })).toBe('曇り');
    expect(classifyWeather({ precipitation: 0.5, sunshineHours: 0 })).toBe('曇り');
  });
  it('降水量が分からない日、雨でなく日照も分からない日は判定しない', () => {
    expect(classifyWeather({ precipitation: null, sunshineHours: 8 })).toBeNull();
    expect(classifyWeather({ precipitation: 0, sunshineHours: null })).toBeNull();
  });
});
