import { checkSurveyAnswers, type ProfileResponse, type SurveyQuestion } from '@dr/shared';
import { useCallback, useEffect, useState } from 'react';
import { ErrorNotice, MessageNotice } from '../../components/ErrorNotice';
import { SurveyForm, toAnswers, type SurveyValues } from '../../components/SurveyForm';
import { api, patchJson } from '../../lib/api';

/** 追加の質問は、答えなくてもよい(7.2)。固定の質問だけを必須として扱う */
const relax = (questions: SurveyQuestion[]) => questions.map((q) => (q.fixedKey ? q : { ...q, required: false }));

/** いまの回答を入力の形にする。選択肢から消えた回答は、選んでいない状態にする */
function toValues(p: ProfileResponse): SurveyValues {
  const values: SurveyValues = {};
  for (const a of p.answers) {
    const q = p.questions.find((x) => x.id === a.questionId);
    if (!q || a.value === null) continue;
    if (q.kind === 'choice' && !q.options.includes(a.value)) continue;
    values[q.id] = a.value;
  }
  return values;
}

/** L-10 プロフィール(C-09)。アンケートの回答を変える。アンケートと同じ部品を使う */
export function ProfilePage() {
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [values, setValues] = useState<SurveyValues>({});
  const [loadError, setLoadError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    setLoadError(null);
    api<ProfileResponse>('/api/me/profile')
      .then((p) => {
        setProfile(p);
        setValues(toValues(p));
      })
      .catch(setLoadError);
  }, []);
  useEffect(load, [load]);

  if (loadError) return <main className="screen"><ErrorNotice error={loadError} onRetry={load} /></main>;
  if (!profile) return <main className="screen"><p className="loading">読み込んでいます…</p></main>;

  const questions = relax(profile.questions);
  const mine = questions.filter((q) => q.target === 'member');
  const household = questions.filter((q) => q.target === 'household');

  const change = (v: SurveyValues) => {
    setValues(v);
    setSaved(false);
  };

  const save = async () => {
    const answers = toAnswers(questions, values);
    const checked = checkSurveyAnswers(questions, answers, true);
    if (!checked.ok) {
      setMessage(checked.message);
      return;
    }
    setMessage(null);
    setError(null);
    setBusy(true);
    try {
      const p = await patchJson<ProfileResponse>('/api/me/profile', { answers });
      setProfile(p);
      setValues(toValues(p));
      setSaved(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="screen">
      <div className="page-head">
        <h2>プロフィール</h2>
        <p className="lead">アンケートの回答を変えられます。個別の回答は、管理者だけが見られます。</p>
      </div>

      {mine.length > 0 && (
        <section className="section prof-section" aria-labelledby="prof-mine">
          <h3 className="section-title" id="prof-mine">
            あなたについて
          </h3>
          <SurveyForm questions={mine} values={values} onChange={change} />
        </section>
      )}
      {household.length > 0 && (
        <section className="section prof-section" aria-labelledby="prof-household">
          <div className="prof-head">
            <h3 className="section-title" id="prof-household">
              おうちについて
            </h3>
            <p className="note">家族みんなで共通の回答です。変えると、ご家族の画面でも変わります。</p>
          </div>
          <SurveyForm questions={household} values={values} onChange={change} />
        </section>
      )}

      {saved && (
        <div className="alert info" role="status">
          <p>保存しました。</p>
        </div>
      )}
      {message && <MessageNotice message={message} />}
      {error ? <ErrorNotice error={error} /> : null}
      <button type="button" className="btn" disabled={busy} onClick={save}>
        {busy ? '保存しています…' : '保存する'}
      </button>
    </main>
  );
}
