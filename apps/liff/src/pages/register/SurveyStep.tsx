import { checkSurveyAnswers, type SurveyQuestion } from '@dr/shared';
import { useState } from 'react';
import { ErrorNotice, MessageNotice } from '../../components/ErrorNotice';
import { Progress } from '../../components/Progress';
import { ActionBar } from '../../components/ActionBar';
import { BusyLabel } from '../../components/BusyLabel';
import { SurveyForm, isLaterQuestion, toAnswers, type SurveyValues } from '../../components/SurveyForm';
import { PressButton } from '../../components/PressButton';

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
  const later = questions.filter(isLaterQuestion);
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
      <Progress step={3} />
      <div className="page-head">
        <h2>かんたんなアンケート</h2>
        <p className="lead">ドッグランをよくするために使います。個別の回答は、管理者だけが見られます。</p>
      </div>
      <SurveyForm questions={questions.filter((q) => !isLaterQuestion(q))} values={values} onChange={onChange} />
      {later.length > 0 && (
        // 2026-10-28 に足した任意の質問(来たい時間帯など)。答えずに登録でき、あとからプロフィールで答えられる
        <section className="section pf-later" aria-labelledby="pf-later-title">
          <div className="pf-later-head">
            <h3 className="section-title" id="pf-later-title">
              よければ教えてください
            </h3>
            <p className="note">選ぶだけです。あとで、会員証の「プロフィール」からでも答えられます。</p>
          </div>
          <SurveyForm questions={later} values={values} onChange={onChange} />
        </section>
      )}
      {message && <MessageNotice message={message} />}
      {error ? <ErrorNotice error={error} /> : null}
      <button type="button" className="btn ghost" disabled={busy} onClick={onBack}>
        ワンちゃんの登録にもどる
      </button>
      <ActionBar>
        <PressButton type="button" className="btn" disabled={busy} onClick={next}>
          <BusyLabel busy={busy} busyText="登録しています…">
            登録する
          </BusyLabel>
        </PressButton>
      </ActionBar>
    </main>
  );
}
