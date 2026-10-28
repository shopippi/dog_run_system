import { describe, expect, it } from 'vitest';
import { checkSurveyAnswers, normalizePostalCode, type SurveyQuestion } from '../src';

const Q: SurveyQuestion[] = [
  { id: 1, fixedKey: 'age_group', target: 'member', kind: 'choice', label: '年代', options: ['20代', '30代'], required: true },
  { id: 3, fixedKey: 'postal_code', target: 'household', kind: 'text', label: '郵便番号', options: [], required: false },
  { id: 9, fixedKey: null, target: 'household', kind: 'text', label: '来てほしいイベント', options: [], required: false },
];

describe('郵便番号', () => {
  it('ハイフンや全角を取りのぞいて7桁にする', () => {
    expect(normalizePostalCode('123-4567')).toBe('1234567');
    expect(normalizePostalCode('〒１２３ー４５６７')).toBe('1234567');
    expect(normalizePostalCode('')).toBeNull();
    expect(normalizePostalCode('12345')).toBeUndefined();
  });
});

describe('アンケートの回答の確認', () => {
  it('必須の質問が空なら、その質問の名前で知らせる', () => {
    const r = checkSurveyAnswers(Q, [], true);
    expect(r).toEqual({ ok: false, message: '「年代」に答えてください。' });
  });

  it('登録後に出す質問では、すべて答えなくてもよい', () => {
    const r = checkSurveyAnswers(Q, [], false);
    expect(r.ok).toBe(true);
  });

  it('選択肢にない回答は受け付けない', () => {
    const r = checkSurveyAnswers(Q, [{ questionId: 1, value: '90代' }], true);
    expect(r.ok).toBe(false);
  });

  it('郵便番号は任意。入れたら7桁にそろえる', () => {
    const ok = checkSurveyAnswers(Q, [{ questionId: 1, value: '30代' }, { questionId: 3, value: '123-4567' }], true);
    expect(ok.ok && ok.values.get(3)).toBe('1234567');
    const ng = checkSurveyAnswers(Q, [{ questionId: 1, value: '30代' }, { questionId: 3, value: '12-34' }], true);
    expect(ng.ok).toBe(false);
  });
});
