import { SURVEY_TEXT_MAX, type SurveyQuestion } from '@dr/shared';
import { useId } from 'react';
import { ChoiceGroup } from './ChoiceGroup';

export type SurveyValues = Record<number, string>;

/** アンケートの入力(7章)。選択式はセグメントかチップ、自由記述は入力欄。 */
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
        if (q.kind === 'choice') {
          return (
            <div className="field" key={q.id}>
              <span className="label" id={`${id}-${q.id}`}>
                {q.label}
                {mark}
              </span>
              <ChoiceGroup
                labelledBy={`${id}-${q.id}`}
                options={q.options.map((o) => ({ value: o, label: o }))}
                value={values[q.id]}
                onChange={(o) => onChange({ ...values, [q.id]: o })}
              />
            </div>
          );
        }
        const postal = q.fixedKey === 'postal_code';
        return (
          <div className="field" key={q.id}>
            <label htmlFor={`${id}-${q.id}`}>
              {q.label}
              {mark}
            </label>
            <input
              id={`${id}-${q.id}`}
              value={values[q.id] ?? ''}
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

export function toAnswers(questions: SurveyQuestion[], values: SurveyValues) {
  return questions.map((q) => ({ questionId: q.id, value: values[q.id]?.trim() ? values[q.id]!.trim() : null }));
}
