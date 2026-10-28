import {
  checkSurveyAnswers,
  type HouseholdDetail,
  type HouseholdProfileResponse,
  type SurveyAnswerValue,
  type SurveyQuestion,
} from '@dr/shared';
import { useEffect, useId, useState } from 'react';
import { ApiError, adminApi, adminPatch } from '../lib/api';
import { Dialog } from './Dialog';
import { ErrorNotice } from './ErrorNotice';

type Values = Record<number, SurveyAnswerValue>;

/**
 * おうちのアンケートの回答を変える(M-06、A-02。担当J)。
 * 郵便番号・知ったきっかけ・来場手段・来たい時間帯・興味のあるイベント・ほかのドッグラン・お知らせ。
 * 受付で聞いた内容を、管理者が代わりに入れるときに使う。変えた内容は操作ログに残り、元に戻せる。
 */
export function HouseholdProfileDialog({
  d,
  onClose,
  onDone,
}: {
  d: HouseholdDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const [data, setData] = useState<HouseholdProfileResponse | null>(null);
  const [values, setValues] = useState<Values>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const id = useId();

  useEffect(() => {
    adminApi<HouseholdProfileResponse>(`/households/${d.id}/profile`).then((r) => {
      setData(r);
      setValues(Object.fromEntries(r.answers.map((a) => [a.questionId, a.value])));
    }, setError);
  }, [d.id]);

  const set = (qid: number, v: SurveyAnswerValue) => setValues((x) => ({ ...x, [qid]: v }));
  const answers = (data?.questions ?? []).map((q) => ({ questionId: q.id, value: values[q.id] ?? null }));

  const save = async () => {
    if (!data) return;
    const checked = checkSurveyAnswers(data.questions, answers, true);
    if (!checked.ok) {
      setError(new ApiError(400, 'invalid', checked.message));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminPatch<HouseholdProfileResponse>(`/households/${d.id}/profile`, { answers });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="おうちの回答を変える"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn" disabled={busy || !data} onClick={save}>
            {busy ? '保存しています…' : '保存する'}
          </button>
        </>
      }
    >
      <p className="sub-text">
        {d.displayName}(<span className="mono">{d.memberNo}</span>)のアンケートの回答です。家族みんなで共通です。変えた内容は操作ログに残ります。
      </p>
      {!data && !error && <p className="sub-text">読み込んでいます…</p>}
      {data && (
        <div className="hp-form">
          {data.questions.map((q) => (
            <Question key={q.id} q={q} idBase={id} value={values[q.id] ?? null} onChange={(v) => set(q.id, v)} />
          ))}
        </div>
      )}
      {error ? <ErrorNotice error={error} /> : null}
    </Dialog>
  );
}

function Question({
  q,
  idBase,
  value,
  onChange,
}: {
  q: SurveyQuestion;
  idBase: string;
  value: SurveyAnswerValue;
  onChange: (v: SurveyAnswerValue) => void;
}) {
  const labelId = `${idBase}-${q.id}`;
  const label = (
    <>
      {q.label}
      {q.required ? <span className="req"> 必須</span> : null}
      {q.kind === 'multi' ? <span className="req"> いくつでも</span> : null}
    </>
  );
  if (q.kind === 'text') {
    return (
      <div className="field">
        <label htmlFor={labelId}>{label}</label>
        <input
          id={labelId}
          value={typeof value === 'string' ? value : ''}
          maxLength={q.fixedKey === 'postal_code' ? 8 : 200}
          inputMode={q.fixedKey === 'postal_code' ? 'numeric' : undefined}
          placeholder={q.fixedKey === 'postal_code' ? '例: 1234567' : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }
  if (q.kind === 'multi') {
    const list = Array.isArray(value) ? value : [];
    return (
      <div className="field">
        <span className="label" id={labelId}>
          {label}
        </span>
        <div className="hp-checks" role="group" aria-labelledby={labelId}>
          {q.options.map((o) => (
            <label key={o}>
              <input
                type="checkbox"
                checked={list.includes(o)}
                onChange={(e) => {
                  const next = e.target.checked ? [...list, o] : list.filter((x) => x !== o);
                  onChange(q.options.filter((x) => next.includes(x)));
                }}
              />
              <span>{o}</span>
            </label>
          ))}
        </div>
      </div>
    );
  }
  // 1つ選ぶ質問。任意の質問は「未回答」に戻せる
  const options = [...q.options.map((o) => ({ value: o as string | null, label: o })), ...(q.required ? [] : [{ value: null, label: '未回答' }])];
  return (
    <div className="field">
      <span className="label" id={labelId}>
        {label}
      </span>
      <div className="chips" role="radiogroup" aria-labelledby={labelId}>
        {options.map((o) => (
          <label key={o.label}>
            <input type="radio" name={labelId} checked={(typeof value === 'string' ? value : null) === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
