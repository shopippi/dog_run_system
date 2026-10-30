import { describe, expect, it } from 'vitest';
import { STAMP_TIMING as T, planStamps, shouldPlay } from './stamp-plan';

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('planStamps(会員証を開いたときの「ポポポン」)', () => {
  it('左上から順に、1つ 70〜90ms ずつずらして押し、1秒以内に全部が終わる', () => {
    const p = planStamps({ on: range(7), fresh: null, bone: 9, play: true });
    expect(p.play).toBe(true);
    expect(p.stagger).toBeGreaterThanOrEqual(70);
    expect(p.stagger).toBeLessThanOrEqual(90);
    const ds = range(7).map((i) => p.delays.get(i)!);
    expect(ds).toEqual([...ds].sort((a, b) => a - b));
    expect(p.end - T.start).toBeLessThanOrEqual(T.budget);
    expect(p.boneAt).toBeNull();
  });

  it('10個(骨まで)でも 70〜90ms のずれで 1 秒以内。骨を押した時刻が分かる', () => {
    const p = planStamps({ on: range(10), fresh: null, bone: 9, play: true });
    expect(p.stagger).toBeGreaterThanOrEqual(70);
    expect(p.stagger).toBeLessThanOrEqual(90);
    expect(p.end - T.start).toBeLessThanOrEqual(T.budget);
    expect(p.boneAt).toBe(Math.round(p.delays.get(9)! + T.duration * T.press));
  });

  it('前回より増えた 1 個は、ほかの最後より少し遅れて押し、押し付けた瞬間が分かる', () => {
    const p = planStamps({ on: range(10), fresh: 9, bone: 9, play: true });
    expect(p.delays.has(9)).toBe(false);
    expect(p.fresh).toBe(9);
    expect(p.freshDelay).toBe(p.delays.get(8)! + T.freshGap);
    expect(p.pressAt).toBe(Math.round(p.freshDelay! + T.freshDuration * T.freshPress));
    expect(p.boneAt).toBe(p.pressAt);
    expect(p.stagger).toBeGreaterThanOrEqual(70);
    expect(p.end - T.start).toBeLessThanOrEqual(T.budget);
  });

  it('1個目が新しく付いたときは、すぐに押す', () => {
    const p = planStamps({ on: [0], fresh: 0, bone: 9, play: true });
    expect(p.delays.size).toBe(0);
    expect(p.freshDelay).toBe(T.start);
  });

  it('2段目まであっても(20個)、1秒以内に全部が終わる', () => {
    const p = planStamps({ on: range(20), fresh: 19, bone: 9, play: true });
    expect(p.end - T.start).toBeLessThanOrEqual(T.budget);
    expect(p.stagger).toBeGreaterThanOrEqual(T.staggerMin);
  });

  it('動かさないときは、時刻を持たない', () => {
    const p = planStamps({ on: range(5), fresh: 4, bone: 9, play: false });
    expect(p.play).toBe(false);
    expect(p.delays.size).toBe(0);
    expect(p.pressAt).toBeNull();
    // 新しく付いた位置だけは覚えておく(印を付けるため)
    expect(p.fresh).toBe(4);
  });
});

describe('shouldPlay(同じ日・同じ数なら 1 日 1 回)', () => {
  it('はじめて・数が変わった・日が変わったときは押す', () => {
    expect(shouldPlay({ memo: null, today: '2026-10-29', points: 3, fresh: false })).toBe(true);
    expect(shouldPlay({ memo: '2026-10-29:2', today: '2026-10-29', points: 3, fresh: false })).toBe(true);
    expect(shouldPlay({ memo: '2026-10-28:3', today: '2026-10-29', points: 3, fresh: false })).toBe(true);
  });
  it('同じ日・同じ数なら押さない。増えた 1 個があれば押す', () => {
    expect(shouldPlay({ memo: '2026-10-29:3', today: '2026-10-29', points: 3, fresh: false })).toBe(false);
    expect(shouldPlay({ memo: '2026-10-29:3', today: '2026-10-29', points: 3, fresh: true })).toBe(true);
  });
  it('0 個なら押すものがない', () => {
    expect(shouldPlay({ memo: null, today: '2026-10-29', points: 0, fresh: false })).toBe(false);
  });
});
