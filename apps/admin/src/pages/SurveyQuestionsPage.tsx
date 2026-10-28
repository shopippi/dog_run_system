import {
  SURVEY_KIND_LABELS,
  SURVEY_TARGET_LABELS,
  type AdminSurveyQuestion,
  type AdminSurveyQuestionsResponse,
  type SurveyKind,
  type SurveyQuestionSummary,
  type SurveyTarget,
} from '@dr/shared';
import { useEffect, useId, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { ErrorNotice } from '../components/ErrorNotice';
import { PageHead } from '../components/PageHead';
import { RadioSegment, formatJstDateTime, useLoaded } from '../components/SettingsKit';
import { adminApi, adminPatch, adminPost } from '../lib/api';
import { useAuth } from '../lib/auth';

const TARGET_OPTIONS = (['member', 'household'] as const).map((v) => ({ value: v, label: SURVEY_TARGET_LABELS[v] }));
const KIND_OPTIONS = (['choice', 'text'] as const).map((v) => ({ value: v, label: SURVEY_KIND_LABELS[v] }));
const toLines = (options: string[]) => options.join('\n');
const fromLines = (text: string) => text.split('\n');

/**
 * M-11 アンケートの設定(A-10)。質問の追加・変更・表示/非表示・並べ替えと、追加した質問の回答の集計。
 * 固定の質問(年代・性別など)は、分析に使うため、文と選択肢だけ変えられる(7.1)。
 */
export function SurveyQuestionsPage() {
  const { data, setData, error, reload } = useLoaded(() => adminApi<AdminSurveyQuestionsResponse>('/survey-questions'));
  const { readOnly } = useAuth();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<AdminSurveyQuestion | null>(null);
  const [summary, setSummary] = useState<AdminSurveyQuestion | null>(null);

  const run = async (fn: () => Promise<AdminSurveyQuestionsResponse>, message: string) => {
    setBusy(true);
    setActionError(null);
    try {
      setData(await fn());
      setNotice(message);
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  };
  const questions = data?.questions ?? [];
  const move = (q: AdminSurveyQuestion, dir: -1 | 1) => {
    const ids = questions.map((x) => x.id);
    const i = ids.indexOf(q.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void run(() => adminPost<AdminSurveyQuestionsResponse>('/survey-questions/order', { ids }), `「${q.label}」を${dir < 0 ? '上' : '下'}へ動かしました。`);
  };

  return (
    <div className="page cfg-page">
      <PageHead
        title="アンケートの設定"
        howto="お客さんに聞く質問です。追加した質問は、すでに登録しているお客さんにも、次にLINEで開いたときに1回だけ出ます(答えなくても使えます)。年代・性別などの固定の質問は分析に使うため、文と選択肢だけ変えられます。"
      />
      {error ? <ErrorNotice error={error} onRetry={reload} /> : null}
      {!readOnly && data && (
        <AddQuestion
          onAdded={(r, label) => {
            setData(r);
            setNotice(`「${label}」を追加しました。`);
          }}
        />
      )}
      {data && (
        <section className="panel list-panel" aria-label="質問の一覧">
          {actionError ? (
            <div className="cfg-list-msg">
              <ErrorNotice error={actionError} />
            </div>
          ) : null}
          <p className="sr-only" role="status">
            {notice}
          </p>
          <ul className="cfg-list" aria-label="質問">
            {questions.map((q, i) => (
              <li key={q.id} className={`cfg-item${q.visible ? '' : ' cfg-off'}`} aria-label={q.label}>
                <span className="cfg-item-no mono">{i + 1}</span>
                <span className="cfg-item-body">
                  <b>{q.label}</b>
                  <span className="sub-text">
                    {SURVEY_TARGET_LABELS[q.target]}
                    <span aria-hidden="true"> · </span>
                    {q.kind === 'choice' ? `選ぶ(${q.options.join('・')})` : '自由に書く'}
                    {q.required ? (
                      <>
                        <span aria-hidden="true"> · </span>登録のとき必須
                      </>
                    ) : null}
                    {q.answerCount !== null ? (
                      <>
                        <span aria-hidden="true"> · </span>回答 {q.answerCount}件
                      </>
                    ) : null}
                  </span>
                </span>
                <span className="badges">
                  {q.isFixed && <span className="badge">固定</span>}
                  {!q.visible && <span className="badge">非表示</span>}
                </span>
                <span className="cfg-item-acts">
                  {!q.isFixed && (
                    <button type="button" className="btn ghost" aria-label={`${q.label}の集計`} onClick={() => setSummary(q)}>
                      集計
                    </button>
                  )}
                  {!readOnly && (
                    <>
                      <button type="button" className="btn ghost" aria-label={`${q.label}を上へ`} disabled={busy || i === 0} onClick={() => move(q, -1)}>
                        上へ
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        aria-label={`${q.label}を下へ`}
                        disabled={busy || i === questions.length - 1}
                        onClick={() => move(q, 1)}
                      >
                        下へ
                      </button>
                      <button type="button" className="btn ghost" aria-label={`${q.label}を変える`} disabled={busy} onClick={() => setEditing(q)}>
                        変える
                      </button>
                      {!q.isFixed && (
                        <button
                          type="button"
                          className="btn ghost"
                          aria-label={`${q.label}を${q.visible ? '非表示にする' : '表示する'}`}
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () => adminPatch<AdminSurveyQuestionsResponse>(`/survey-questions/${q.id}`, { visible: !q.visible }),
                              `「${q.label}」を${q.visible ? '非表示にしました' : '表示に戻しました'}。`,
                            )
                          }
                        >
                          {q.visible ? '非表示にする' : '表示する'}
                        </button>
                      )}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!data && !error && <p className="loading">読み込んでいます…</p>}
      {editing && (
        <EditQuestion
          q={editing}
          onClose={() => setEditing(null)}
          onDone={(r) => {
            setData(r);
            setNotice('質問を変えました。');
            setEditing(null);
          }}
        />
      )}
      {summary && <SummaryDialog q={summary} onClose={() => setSummary(null)} />}
    </div>
  );
}

function AddQuestion({ onAdded }: { onAdded: (r: AdminSurveyQuestionsResponse, label: string) => void }) {
  const [target, setTarget] = useState<SurveyTarget>('member');
  const [kind, setKind] = useState<SurveyKind>('choice');
  const [label, setLabel] = useState('');
  const [options, setOptions] = useState('');
  const [required, setRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const labelId = useId();
  const optionsId = useId();
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await adminPost<AdminSurveyQuestionsResponse>('/survey-questions', {
        target,
        kind,
        label,
        options: kind === 'choice' ? fromLines(options) : [],
        required,
      });
      onAdded(r, label.trim());
      setLabel('');
      setOptions('');
      setRequired(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel cfg-add" aria-label="質問を追加">
      <form
        className="cfg-fieldset"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="cfg-row">
          <RadioSegment label="聞く相手" options={TARGET_OPTIONS} value={target} onChange={setTarget} />
          <RadioSegment label="答え方" options={KIND_OPTIONS} value={kind} onChange={setKind} />
        </div>
        <p className="hint">
          「家族一人ひとり」はLINEのアカウントごとに、「おうちごと」はおうちの誰か1人に聞きます。
        </p>
        <div className="field">
          <label htmlFor={labelId}>質問の文</label>
          <input id={labelId} value={label} maxLength={100} placeholder="例: ほかのドッグランも使っていますか" onChange={(e) => setLabel(e.target.value)} />
        </div>
        {kind === 'choice' && (
          <div className="field">
            <label htmlFor={optionsId}>選択肢(1行に1つ)</label>
            <textarea id={optionsId} className="cfg-textarea" rows={4} value={options} placeholder={'例:\nよく使う\nときどき使う\n使わない'} onChange={(e) => setOptions(e.target.value)} />
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          はじめて登録する人には必ず答えてもらう
        </label>
        <div className="cfg-acts">
          <button type="submit" className="btn" disabled={busy || !label.trim()}>
            {busy ? '追加しています…' : '追加する'}
          </button>
        </div>
      </form>
      {error ? <ErrorNotice error={error} /> : null}
    </section>
  );
}

function EditQuestion({ q, onClose, onDone }: { q: AdminSurveyQuestion; onClose: () => void; onDone: (r: AdminSurveyQuestionsResponse) => void }) {
  const [target, setTarget] = useState<SurveyTarget>(q.target);
  const [kind, setKind] = useState<SurveyKind>(q.kind);
  const [label, setLabel] = useState(q.label);
  const [options, setOptions] = useState(toLines(q.options));
  const [required, setRequired] = useState(q.required);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const labelId = useId();
  const optionsId = useId();
  const answered = (q.answerCount ?? 0) > 0;
  const submit = async () => {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { label };
    if (kind === 'choice') body.options = fromLines(options);
    if (!q.isFixed) Object.assign(body, { target, kind, required });
    try {
      onDone(await adminPatch<AdminSurveyQuestionsResponse>(`/survey-questions/${q.id}`, body));
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="質問を変える"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn" disabled={busy || !label.trim()} onClick={submit}>
            {busy ? '保存しています…' : '保存する'}
          </button>
        </>
      }
    >
      {q.isFixed ? (
        <p className="sub-text">固定の質問です。分析に使うため、文と選択肢だけ変えられます。</p>
      ) : (
        <>
          <RadioSegment label="聞く相手" options={TARGET_OPTIONS} value={target} onChange={setTarget} disabled={answered} />
          <RadioSegment label="答え方" options={KIND_OPTIONS} value={kind} onChange={setKind} disabled={answered} />
          {answered && <p className="hint">回答があるので、聞く相手と答え方は変えられません。</p>}
        </>
      )}
      <div className="field">
        <label htmlFor={labelId}>質問の文</label>
        <input id={labelId} value={label} maxLength={100} onChange={(e) => setLabel(e.target.value)} />
      </div>
      {kind === 'choice' && (
        <div className="field">
          <label htmlFor={optionsId}>選択肢(1行に1つ)</label>
          <textarea id={optionsId} className="cfg-textarea" rows={5} value={options} onChange={(e) => setOptions(e.target.value)} />
          {answered || q.isFixed ? <span className="hint">選択肢を変えても、これまでの回答はそのまま残ります。</span> : null}
        </div>
      )}
      {!q.isFixed && (
        <label className="check">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          はじめて登録する人には必ず答えてもらう
        </label>
      )}
      {error ? <ErrorNotice error={error} /> : null}
    </Dialog>
  );
}

/** 追加した質問の回答の集計(選択肢ごとの数)。自由に書く質問は、新しい回答から並べる */
function SummaryDialog({ q, onClose }: { q: AdminSurveyQuestion; onClose: () => void }) {
  const [data, setData] = useState<SurveyQuestionSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    adminApi<SurveyQuestionSummary>(`/survey-questions/${q.id}/summary`).then(setData, setError);
  }, [q.id]);
  const max = Math.max(1, ...(data?.counts.map((c) => c.count) ?? []));
  return (
    <Dialog
      title="回答の集計"
      onClose={onClose}
      footer={
        <button type="button" className="btn sub" data-autofocus onClick={onClose}>
          閉じる
        </button>
      }
    >
      <p>
        <b>{q.label}</b>
      </p>
      {error ? <ErrorNotice error={error} /> : null}
      {!data && !error && <p className="sub-text">読み込んでいます…</p>}
      {data && (
        <>
          <p className="sub-text">
            答えた {data.answered}件<span aria-hidden="true"> · </span>答えない {data.skipped}件
          </p>
          {q.kind === 'choice' ? (
            <ul className="cfg-bars" aria-label="選択肢ごとの数">
              {data.counts.map((c) => (
                <li key={c.option} aria-label={`${c.option} ${c.count}件`}>
                  <span className="cfg-bar-label">
                    {c.option}
                    {!c.current && <span className="sub-text">(今はない選択肢)</span>}
                  </span>
                  <span className="cfg-bar-track" aria-hidden="true">
                    <span className="cfg-bar" style={{ width: `${(c.count / max) * 100}%` }} />
                  </span>
                  <span className="cfg-bar-n">{c.count}件</span>
                </li>
              ))}
            </ul>
          ) : data.texts.length === 0 ? (
            <p className="sub-text">まだ回答はありません。</p>
          ) : (
            <ul className="cfg-texts" aria-label="回答">
              {data.texts.map((t, i) => (
                <li key={i}>
                  <span>{t.answer}</span>
                  <span className="note">{formatJstDateTime(t.answeredAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Dialog>
  );
}
