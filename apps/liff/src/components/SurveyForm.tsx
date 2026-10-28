import { MULTI_SURVEY_KEYS, SURVEY_TEXT_MAX, YES_NO_SURVEY_KEYS, type SurveyAnswerValue, type SurveyQuestion } from '@dr/shared';
import { useId } from 'react';
import { CheckList } from './CheckList';
import { ChoiceGroup } from './ChoiceGroup';

/** 入力中の回答。いくつでも選ぶ質問(multi)は、選んだ選択肢の配列 */
export type SurveyValues = Record<number, string | string[]>;

/** 2026-10-28 に足した、おうちへの任意の質問(来たい時間帯など)。登録では「あとでも答えられる」欄にまとめる */
export const LATER_SURVEY_KEYS: readonly string[] = [...MULTI_SURVEY_KEYS, ...YES_NO_SURVEY_KEYS];
export const isLaterQuestion = (q: SurveyQuestion) => q.fixedKey !== null && LATER_SURVEY_KEYS.includes(q.fixedKey);

/** アンケートの入力(7章)。選択式はセグメントかチップ、いくつでも選ぶ質問はチェックボックスのチップ、自由記述は入力欄。 */
export function SurveyForm({
  questions,
  values,
  onChange,
  showRequired = true,
}: {
  questions: SurveyQuestion[];
  values: SurveyValues;
  onChange: (v: SurveyValues) => void;
  showRequired?: boolean;
}) {
  const id = useId();
  return (
    <div className="fields">
      {questions.map((q) => {
        const mark = showRequired && q.required ? <span className="req">必須</span> : null;
        if (q.kind === 'multi') {
          const v = values[q.id];
          return (
            <div className="field" key={q.id}>
              <span className="label" id={`${id}-${q.id}`}>
                {q.label}
                {mark}
                <span className="pf-many">いくつでも</span>
              </span>
              <CheckList
                labelledBy={`${id}-${q.id}`}
                options={q.options}
                value={Array.isArray(v) ? v : []}
                onChange={(list) => onChange({ ...values, [q.id]: list })}
              />
            </div>
          );
        }
        if (q.kind === 'choice') {
          const v = values[q.id];
          return (
            <div className="field" key={q.id}>
              <span className="label" id={`${id}-${q.id}`}>
                {q.label}
                {mark}
              </span>
              <ChoiceGroup
                labelledBy={`${id}-${q.id}`}
                options={q.options.map((o) => ({ value: o, label: o }))}
                value={typeof v === 'string' ? v : undefined}
                onChange={(o) => onChange({ ...values, [q.id]: o })}
              />
            </div>
          );
        }
        const postal = q.fixedKey === 'postal_code';
        const v = values[q.id];
        return (
          <div className="field" key={q.id}>
            <label htmlFor={`${id}-${q.id}`}>
              {q.label}
              {mark}
            </label>
            <input
              id={`${id}-${q.id}`}
              value={typeof v === 'string' ? v : ''}
              maxLength={postal ? 8 : SURVEY_TEXT_MAX}
              inputMode={postal ? 'numeric' : undefined}
              autoComplete={postal ? 'postal-code' : 'off'}
              placeholder={postal ? '例: 1234567' : undefined}
              className={postal ? 'w-postal' : undefined}
              onChange={(e) => onChange({ ...values, [q.id]: e.target.value })}
            />
            {postal && <span className="hint">チラシを配る地域を決めるために使います。入力しなくても登録できます。</span>}
          </div>
        );
      })}
    </div>
  );
}

export function toAnswers(questions: SurveyQuestion[], values: SurveyValues): { questionId: number; value: SurveyAnswerValue }[] {
  return questions.map((q) => {
    const v = values[q.id];
    if (q.kind === 'multi') return { questionId: q.id, value: Array.isArray(v) && v.length ? v : null };
    return { questionId: q.id, value: typeof v === 'string' && v.trim() ? v.trim() : null };
  });
}

/** いまの回答(API)を入力の形にする。選択肢から消えた回答は、選んでいない状態にする */
export function toSurveyValues(questions: SurveyQuestion[], answers: { questionId: number; value: SurveyAnswerValue }[]): SurveyValues {
  const values: SurveyValues = {};
  for (const a of answers) {
    const q = questions.find((x) => x.id === a.questionId);
    if (!q || a.value === null) continue;
    if (q.kind === 'multi') {
      const list = (Array.isArray(a.value) ? a.value : [a.value]).filter((x) => q.options.includes(x));
      if (list.length) values[q.id] = list;
      continue;
    }
    if (Array.isArray(a.value)) continue;
    if (q.kind === 'choice' && !q.options.includes(a.value)) continue;
    values[q.id] = a.value;
  }
  return values;
}
