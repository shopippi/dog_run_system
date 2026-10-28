import { describe, expect, it } from 'vitest';
import {
  BREED_GROUP_ALIASES,
  DOG_SOCIABILITY_LABELS,
  INITIAL_BREEDS,
  checkSurveyAnswers,
  currentJstYear,
  decodeMultiAnswer,
  dogInputSchema,
  encodeMultiAnswer,
  parseWeightInput,
  surveyAnswerText,
  type SurveyQuestion,
} from '../src';

// 飼い主とワンちゃんの情報(担当J): 複数選択の回答、体重・予防注射の年の入力チェック、犬種の一覧

const multi: SurveyQuestion = {
  id: 6,
  fixedKey: 'preferred_times',
  target: 'household',
  kind: 'multi',
  label: '来たい時間帯',
  options: ['平日の昼', '平日の夕方', '土日の午前', '土日の午後'],
  required: false,
};
const yesNo: SurveyQuestion = { ...multi, id: 8, fixedKey: 'uses_other_runs', kind: 'choice', label: 'ほかのドッグラン', options: ['はい', 'いいえ'] };

describe('複数選択の回答', () => {
  it('選択肢の順に並べ、重ねず、JSON の配列で保存する。空は null', () => {
    const r = checkSurveyAnswers([multi], [{ questionId: 6, value: ['土日の午後', '平日の昼', '平日の昼'] }], true);
    expect(r).toEqual({ ok: true, values: new Map([[6, '["平日の昼","土日の午後"]']]) });
    const empty = checkSurveyAnswers([multi], [{ questionId: 6, value: [] }], true);
    expect(empty.ok && empty.values.get(6)).toBeNull();
    expect(encodeMultiAnswer([], multi.options)).toBeNull();
  });

  it('選択肢にない回答・必須で空・1つ選ぶ質問への配列は受け付けない', () => {
    expect(checkSurveyAnswers([multi], [{ questionId: 6, value: ['深夜'] }], true)).toMatchObject({ ok: false });
    expect(checkSurveyAnswers([{ ...multi, required: true }], [{ questionId: 6, value: [] }], true)).toEqual({
      ok: false,
      message: '「来たい時間帯」を1つ以上選んでください。',
    });
    expect(checkSurveyAnswers([yesNo], [{ questionId: 8, value: ['はい'] }], true)).toMatchObject({ ok: false });
    expect(checkSurveyAnswers([yesNo], [{ questionId: 8, value: 'はい' }], true)).toMatchObject({ ok: true });
  });

  it('保存した回答を読み、画面の文にする', () => {
    expect(decodeMultiAnswer('["平日の昼","土日の午後"]')).toEqual(['平日の昼', '土日の午後']);
    expect(decodeMultiAnswer(null)).toEqual([]);
    expect(surveyAnswerText('multi', '["平日の昼","土日の午後"]')).toBe('平日の昼・土日の午後');
    expect(surveyAnswerText('choice', 'はい')).toBe('はい');
    expect(surveyAnswerText('multi', '[]')).toBeNull();
  });
});

describe('ワンちゃんの任意の項目', () => {
  const base = { name: 'アル', breedId: 1, size: 'small' as const };
  const ok = (extra: Record<string, unknown>) => dogInputSchema.safeParse({ ...base, ...extra }).success;

  it('体重は 0.1〜100.0 の小数1桁。画面の入力は全角や「kg」つきでも読める', () => {
    expect([0.1, 5.2, 100].map((w) => ok({ weightKg: w }))).toEqual([true, true, true]);
    expect([0, 0.05, 100.1, 5.25, -1].map((w) => ok({ weightKg: w }))).toEqual([false, false, false, false, false]);
    expect(parseWeightInput('５.２')).toBe(5.2);
    expect(parseWeightInput(' 12kg ')).toBe(12);
    expect(parseWeightInput('')).toBeNull();
    expect(parseWeightInput('五キロ')).toBeNaN();
  });

  it('予防注射の年は 2000年から今年まで。相性は 得意・ふつう・苦手', () => {
    const year = currentJstYear();
    expect([2000, year].map((y) => ok({ rabiesVaccineYear: y, comboVaccineYear: y }))).toEqual([true, true]);
    expect([1999, year + 1, 2020.5].map((y) => ok({ rabiesVaccineYear: y }))).toEqual([false, false, false]);
    expect(Object.values(DOG_SOCIABILITY_LABELS)).toEqual(['得意', 'ふつう', '苦手']);
    expect(ok({ sociability: 'shy' })).toBe(true);
    expect(ok({ sociability: 'angry' })).toBe(false);
  });
});

describe('犬種の一覧(大まかな分け方)', () => {
  it('26件で、ミックス・その他が最後。細かい犬種名は、一覧の大まかな犬種名に対応している', () => {
    expect(INITIAL_BREEDS).toHaveLength(26);
    expect(INITIAL_BREEDS.slice(-2).map((b) => b.name)).toEqual(['ミックス', 'その他']);
    expect(INITIAL_BREEDS.filter((b) => b.isOther).map((b) => b.name)).toEqual(['その他']);
    const names = new Set(INITIAL_BREEDS.map((b) => b.name));
    for (const group of Object.values(BREED_GROUP_ALIASES)) expect(names.has(group), group).toBe(true);
    expect(BREED_GROUP_ALIASES['ミニチュアダックスフンド']).toBe('ダックスフンド');
    expect(BREED_GROUP_ALIASES['カニンヘンダックスフンド']).toBe('ダックスフンド');
    expect(BREED_GROUP_ALIASES['トイプードル']).toBe('プードル');
    expect(BREED_GROUP_ALIASES['ロングコートチワワ']).toBe('チワワ');
  });
});
