import { checkSurveyAnswers, type SurveyQuestion } from '@dr/shared';
import { useState } from 'react';
import { ErrorNotice } from '../../components/ErrorNotice';
import { SurveyForm, toAnswers, type SurveyValues } from '../../components/SurveyForm';

type Props = {
  questions: SurveyQuestion[];
  values: SurveyValues;
  onChange: (v: SurveyValues) => void;
  onBack: () => void;
  onNext: () => Promise<void>;
  busy: boolean;
  error: unknown;
};

/** L-03 アンケート(C-03)。1分以内で答えられる量にしている(7章)。 */
export function SurveyStep({ questions, values, onChange, onBack, onNext, busy, error }: Props) {
  const [message, setMessage] = useState<string | null>(null);
  const next = () => {
    const r = checkSurveyAnswers(questions, toAnswers(questions, values), true);
    if (!r.ok) {
      setMessage(r.message);
      return;
    }
    setMessage(null);
    void onNext();
  };
  return (
    <main className="screen">
      <h2>かんたんなアンケート</h2>
      <p className="small muted">ドッグランをよくするために使います。個別の回答は、管理者だけが見られます。</p>
      <SurveyForm questions={questions} values={values} onChange={onChange} />
      {message && (
        <div className="notice bad" role="alert">
          <p>{message}</p>
        </div>
      )}
      {error ? <ErrorNotice error={error} /> : null}
      <button type="button" className="btn" disabled={busy} onClick={next}>
        {busy ? '登録しています…' : '登録する'}
      </button>
      <button type="button" className="btn sub" disabled={busy} onClick={onBack}>
        ワンちゃんの登録にもどる
      </button>
    </main>
  );
}
