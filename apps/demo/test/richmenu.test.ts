import { describe, expect, it } from 'vitest';
import { RICH_MENU_AREAS } from '../src/LineTalk';

// LINE 公式アカウントの「大」6 マス(3 列 × 2 段、2500×1686)。docs/line/richmenu.md と同じ
const COLS = [0, 833, 1667, 2500];
const ROWS = [0, 843, 1686];

describe('デモのリッチメニュー', () => {
  it('押せる場所は、LINE の 6 マスの区切りにぴったり合い、すき間も重なりもない', () => {
    let area = 0;
    for (const a of RICH_MENU_AREAS) {
      expect(COLS).toContain(a.x);
      expect(COLS).toContain(a.x + a.w);
      expect(ROWS).toContain(a.y);
      expect(ROWS).toContain(a.y + a.h);
      area += a.w * a.h;
    }
    expect(area).toBe(2500 * 1686);
  });

  it('会員証は上の段の左 2 マス(A・B)をまとめた一番大きな場所で、ほかは 1 マスずつ', () => {
    const card = RICH_MENU_AREAS.find((a) => a.label === '会員証');
    expect(card).toMatchObject({ x: 0, y: 0, w: 1667, h: 843, route: '/' });
    expect(RICH_MENU_AREAS.map((a) => a.label)).toEqual(['会員証', 'チェックイン', '来場の記録', 'ワンちゃん', '使い方']);
  });
});
