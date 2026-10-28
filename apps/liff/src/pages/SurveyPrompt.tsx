import type { SurveyQuestion } from '@dr/shared';
import { useState } from 'react';
import { ErrorNotice } from '../components/ErrorNotice';
import { SurveyForm, toAnswers, type SurveyValues } from '../components/SurveyForm';
import { postJson } from '../lib/api';

/**
 * 登録のあとに管理者が追加した質問を、次に開いたときに1回だけ出す(7.2)。
 * 答えなくても「答えずに進む」で使える。
 */
export function SurveyPrompt({ questions, onDone }: { questions: SurveyQuestion[]; onDone: () => void }) {
  const [values, setValues] = useState<SurveyValues>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const send = async (skipAll: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const answers = skipAll ? questions.map((q) => ({ questionId: q.id, value: null })) : toAnswers(questions, values);
      await postJson('/api/survey', { answers });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <main className="screen">
      <div className="page-head">
        <h2>アンケートにご協力ください</h2>
        <p className="lead">答えなくても会員証は使えます。この画面は1回だけ表示します。</p>
      </div>
      <SurveyForm questions={questions} values={values} onChange={setValues} showRequired={false} />
      {error ? <ErrorNotice error={error} /> : null}
      <div className="actions">
        <button type="button" className="btn" disabled={busy} onClick={() => send(false)}>
          回答する
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => send(true)}>
          答えずに進む
        </button>
      </div>
    </main>
  );
}
