import { describe, expect, it } from 'vitest';
import { birthMonthText, milestoneText, todayStampIndices, visitMilestone } from '../src/keepsakes';

describe('小さな記念', () => {
  it('来場の回数の節目は 10・30・50・100 回', () => {
    expect([9, 10, 11, 30, 50, 100, 101].map(visitMilestone)).toEqual([null, 10, null, 30, 50, 100, null]);
    expect(milestoneText(['こむぎ'], 30)).toBe('こむぎちゃんと 30回目の来場です');
    expect(milestoneText(['こむぎ', 'だいず'], 10)).toBe('こむぎちゃん・だいずちゃんと 10回目の来場です');
  });
  it('誕生月は、生まれた年月がある子だけ。日本時間の今月で決める', () => {
    const dogs = [
      { name: 'こむぎ', birthYm: '2021-11' },
      { name: 'だいず', birthYm: null },
      { name: 'あずき', birthYm: '2019-11' },
      { name: 'もも', birthYm: '2020-03' },
    ];
    expect(birthMonthText(dogs, '2026-11-02')).toBe('11月はこむぎ・あずきの誕生月です');
    expect(birthMonthText(dogs, '2026-03-31')).toBe('3月はももの誕生月です');
    expect(birthMonthText(dogs, '2026-10-29')).toBeNull();
  });
  it('今日のスタンプは、たまっている分の最後の今日の数', () => {
    expect(todayStampIndices(3, 1, 20)).toEqual([2]);
    expect(todayStampIndices(3, 0, 20)).toEqual([]);
    expect(todayStampIndices(1, 2, 20)).toEqual([0]);
    expect(todayStampIndices(25, 1, 20)).toEqual([]);
    expect(todayStampIndices(0, 1, 20)).toEqual([]);
  });
});
