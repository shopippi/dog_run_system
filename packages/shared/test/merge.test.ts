import { describe, expect, it } from 'vitest';
import {
  defaultKeepHousehold,
  mergeUndoDeadline,
  mergeUndoStatus,
  planMergeDogs,
  planMergePoints,
  sameDayVisitDates,
  validateDogPairs,
  type MergeDogProfile,
} from '../src';

describe('おうちの統合: ポイントの合算(5.3)', () => {
  it('7ポイントと5ポイントを統合すると、残高は2ポイント、無料券は1枚増える(19.2)', () => {
    const p = planMergePoints(7, 5, 10);
    expect(p).toMatchObject({ total: 12, ticketsIssued: 1, balanceAfter: 2 });
    expect(p.ledger).toEqual([
      { household: 'absorbed', delta: -5, kind: 'merge' },
      { household: 'kept', delta: 5, kind: 'merge' },
      { household: 'kept', delta: -10, kind: 'ticket_issue' },
    ]);
  });

  it('合計が9なら無料券は出ない(境界の1つ手前)', () => {
    expect(planMergePoints(4, 5, 10)).toMatchObject({ total: 9, ticketsIssued: 0, balanceAfter: 9 });
  });

  it('合計がちょうど10なら無料券が1枚出て、残高は0になる', () => {
    expect(planMergePoints(5, 5, 10)).toMatchObject({ total: 10, ticketsIssued: 1, balanceAfter: 0 });
  });

  it('合計が20以上なら、その分の枚数を発行する', () => {
    const p = planMergePoints(9, 9, 6);
    expect(p).toMatchObject({ total: 18, ticketsIssued: 3, balanceAfter: 0 });
    expect(p.ledger.filter((l) => l.kind === 'ticket_issue')).toHaveLength(3);
  });

  it('まとめる側が0ポイントなら、統合の行は書かない', () => {
    expect(planMergePoints(3, 0, 10)).toEqual({ total: 3, ticketsIssued: 0, balanceAfter: 3, ledger: [] });
  });

  it('設定で「同じ日の分を残さない」にしたときは、その点数を差し引いてから無料券を数える', () => {
    const p = planMergePoints(7, 4, 10, 1);
    expect(p).toMatchObject({ total: 10, ticketsIssued: 1, balanceAfter: 0 });
    expect(p.ledger).toContainEqual({ household: 'kept', delta: -1, kind: 'merge' });
    expect(planMergePoints(7, 4, 10, 0).ledger).not.toContainEqual({ household: 'kept', delta: -1, kind: 'merge' });
  });

  it('台帳の行を合計すると、両方の残高の合計から発行した分を引いた値になる', () => {
    const p = planMergePoints(7, 5, 10);
    const kept = 7 + p.ledger.filter((l) => l.household === 'kept').reduce((s, l) => s + l.delta, 0);
    const absorbed = 5 + p.ledger.filter((l) => l.household === 'absorbed').reduce((s, l) => s + l.delta, 0);
    expect({ kept, absorbed }).toEqual({ kept: 2, absorbed: 0 });
  });
});

describe('おうちの統合: 犬の組み合わせ', () => {
  const dog = (id: number, name: string, extra: Partial<MergeDogProfile> = {}): MergeDogProfile => ({
    id,
    name,
    breedName: 'トイプードル',
    size: 'small',
    sex: null,
    birthYm: null,
    photoUrl: null,
    thumbUrl: null,
    ...extra,
  });

  it('組み合わせた2頭は1頭になる。犬IDは残す側、写真・名前・犬種は選んだ方', () => {
    const keep = [dog(1, 'アル', { sex: 'male' }), dog(2, 'ニコ')];
    const absorb = [dog(5, 'あるくん', { breedName: '柴犬', size: 'medium', photoUrl: '/p5', birthYm: '2020-04' }), dog(6, 'モカ')];
    const out = planMergeDogs(keep, absorb, [{ keep: 1, absorb: 5, take: 'absorb' }]);
    expect(out.map((d) => [d.id, d.name, d.mergedFromId])).toEqual([
      [1, 'あるくん', 5],
      [2, 'ニコ', null],
      [6, 'モカ', null],
    ]);
    // 写真・犬種は選んだ方。性別は選んだ方が空なので、もう一方から補う
    expect(out[0]).toMatchObject({ breedName: '柴犬', size: 'medium', photoUrl: '/p5', sex: 'male', birthYm: '2020-04' });
  });

  it('残す側を選んだら、残す側の写真と名前のまま', () => {
    const out = planMergeDogs([dog(1, 'アル', { photoUrl: '/p1' })], [dog(5, 'あるくん', { photoUrl: '/p5' })], [
      { keep: 1, absorb: 5, take: 'keep' },
    ]);
    expect(out).toEqual([expect.objectContaining({ id: 1, name: 'アル', photoUrl: '/p1', mergedFromId: 5 })]);
  });

  it('組み合わせを確かめる', () => {
    expect(validateDogPairs([{ keep: 1, absorb: 5, take: 'keep' }], [1, 2], [5, 6])).toBeNull();
    expect(validateDogPairs([], [1], [5])).toBeNull();
    // 向きが逆(まとめる側の犬を残す側に入れた)
    expect(validateDogPairs([{ keep: 5, absorb: 1, take: 'keep' }], [1, 2], [5, 6])).toMatch(/組み合わせ直して/);
    // 1頭を2回使う
    expect(
      validateDogPairs(
        [
          { keep: 1, absorb: 5, take: 'keep' },
          { keep: 1, absorb: 6, take: 'keep' },
        ],
        [1, 2],
        [5, 6],
      ),
    ).toMatch(/2頭と組み合わせる/);
    expect(
      validateDogPairs(
        [
          { keep: 1, absorb: 5, take: 'keep' },
          { keep: 2, absorb: 5, take: 'keep' },
        ],
        [1, 2],
        [5, 6],
      ),
    ).toMatch(/2頭と組み合わせる/);
  });
});

describe('おうちの統合: そのほか', () => {
  it('残す会員IDの初期値は、登録が古い方', () => {
    const a = { id: 3, registeredAt: '2026-05-01T10:00:00+09:00' };
    const b = { id: 1, registeredAt: '2026-06-01T10:00:00+09:00' };
    expect(defaultKeepHousehold(a, b)).toBe(3);
    expect(defaultKeepHousehold(b, a)).toBe(3);
    // 同じ日時なら会員IDの番号が小さい方
    expect(defaultKeepHousehold({ id: 7, registeredAt: a.registeredAt }, { id: 4, registeredAt: a.registeredAt })).toBe(4);
  });

  it('両方が来場していた日を出す', () => {
    expect(sameDayVisitDates(['2026-10-01', '2026-10-05', '2026-10-07'], ['2026-10-05', '2026-10-02', '2026-10-07'])).toEqual([
      '2026-10-05',
      '2026-10-07',
    ]);
    expect(sameDayVisitDates([], ['2026-10-05'])).toEqual([]);
  });

  it('元に戻せるのは30日以内(30日後の同じ時刻まで)', () => {
    const executedAt = '2026-10-01T10:00:00+09:00';
    expect(mergeUndoDeadline(executedAt).toISOString()).toBe('2026-10-31T01:00:00.000Z');
    const at = (iso: string) => mergeUndoStatus({ executedAt, undoneAt: null, now: new Date(iso), changedAfter: false });
    expect(at('2026-10-31T10:00:00+09:00')).toBe('ok');
    expect(at('2026-10-31T10:00:01+09:00')).toBe('expired');
  });

  it('統合後に来場やポイントの変更があれば戻せない。戻したものは二度と戻さない', () => {
    const executedAt = '2026-10-01T10:00:00+09:00';
    const now = new Date('2026-10-02T10:00:00+09:00');
    expect(mergeUndoStatus({ executedAt, undoneAt: null, now, changedAfter: true })).toBe('changed');
    expect(mergeUndoStatus({ executedAt, undoneAt: '2026-10-01T11:00:00+09:00', now, changedAfter: false })).toBe('undone');
  });
});
