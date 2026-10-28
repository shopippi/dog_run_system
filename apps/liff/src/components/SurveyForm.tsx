import { SURVEY_TEXT_MAX, type SurveyQuestion } from '@dr/shared';
import { useId } from 'react';

export type SurveyValues = Record<number, string>;

/** アンケートの入力(7章)。選択式はボタン、自由記述は入力欄。 */
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
    <div className="panel">
      {questions.map((q) => {
        const mark = showRequired && q.required ? <span className="req">必須</span> : <span className="opt">任意</span>;
        if (q.kind === 'choice') {
          return (
            <div className="field" key={q.id}>
              <span className="label" id={`${id}-${q.id}`}>
                {q.label}
                {mark}
              </span>
              <div className="choices" role="radiogroup" aria-labelledby={`${id}-${q.id}`}>
                {q.options.map((o) => (
                  <label key={o}>
                    <input
                      type="radio"
                      name={`${id}-${q.id}`}
                      checked={values[q.id] === o}
                      onChange={() => onChange({ ...values, [q.id]: o })}
                    />
                    {o}
                  </label>
                ))}
              </div>
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
