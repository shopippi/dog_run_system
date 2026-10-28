import { checkSurveyAnswers, type InviteAcceptResult, type InviteInfo } from '@dr/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DogAvatar } from '../../components/DogAvatar';
import { ErrorNotice } from '../../components/ErrorNotice';
import { SurveyForm, toAnswers, type SurveyValues } from '../../components/SurveyForm';
import { api, postJson } from '../../lib/api';

/**
 * L-12 招待を受けたときの画面(C-12)。
 * はじめての人は同意と年代・性別だけで参加できる(犬の登録は要らない)。
 * 別のおうちがある人は、その場では参加せず「おうちをまとめる申請」になる(5.1)。
 */
export function JoinPage({ onJoined }: { onJoined: () => void }) {
  const { code = '' } = useParams();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [agreed, setAgreed] = useState(false);
  const [values, setValues] = useState<SurveyValues>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<InviteAcceptResult | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<InviteInfo>(`/api/invites/${encodeURIComponent(code)}`).then(setInfo).catch(setError);
  }, [code]);
  useEffect(load, [load]);

  const accept = async () => {
    if (!info) return;
    if (info.viewer === 'new') {
      if (!agreed) {
        setMessage('利用規約とプライバシーポリシーへの同意が必要です。チェックを入れてください。');
        return;
      }
      const r = checkSurveyAnswers(info.questions, toAnswers(info.questions, values), true);
      if (!r.ok) {
        setMessage(r.message);
        return;
      }
    }
    setMessage(null);
    setBusy(true);
    setError(null);
    try {
      const res = await postJson<InviteAcceptResult>(`/api/invites/${encodeURIComponent(code)}/accept`, {
        consent: agreed,
        survey: toAnswers(info.questions, values),
      });
      setDone(res);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (!info) {
    return (
      <main className="screen">
        {error ? <ErrorNotice error={error} onRetry={load} /> : <p className="loading">読み込んでいます…</p>}
      </main>
    );
  }

  if (done?.result === 'joined') {
    return (
      <main className="screen">
        <div className="welcome-card">
          <p>参加しました</p>
          <p className="name">{done.householdName}</p>
          <p className="small">会員ID</p>
          <p className="id mono">{done.memberNo}</p>
        </div>
        <p className="small muted">これからは、このLINEでチェックインしても、同じ会員証にポイントがたまります。</p>
        <button type="button" className="btn" onClick={onJoined}>
          会員証を見る
        </button>
      </main>
    );
  }

  if (done?.result === 'requested') {
    return (
      <main className="screen">
        <div className="notice good" role="status">
          <p>
            <b>おうちをまとめる申請をしました</b>
          </p>
          <p className="small">
            受付で、ワンちゃんの写真を見ながら2つのおうちを1つにまとめます。まとまるまでは、今の会員証をそのまま使えます。
          </p>
        </div>
        <Link to="/" className="btn sub as-link" onClick={onJoined}>
          会員証にもどる
        </Link>
      </main>
    );
  }

  const header = (
    <div className="invite-card">
      <div className="faces">
        {info.dogs.map((d) => (
          <DogAvatar key={d.id} name={d.name} breedName={d.breedName} url={d.thumbUrl} size={64} />
        ))}
      </div>
      <p className="invite-name">{info.householdName}</p>
    </div>
  );

  if (info.viewer === 'member') {
    return (
      <main className="screen">
        {header}
        <div className="notice good">
          <p>すでにこのおうちの家族です。</p>
        </div>
        <Link to="/" className="btn as-link" onClick={onJoined}>
          会員証を見る
        </Link>
      </main>
    );
  }

  if (info.status !== 'valid') {
    return (
      <main className="screen">
        {header}
        <div className="notice bad" role="alert">
          <p>{info.status === 'used' ? 'この招待はもう使われています。' : '招待の期限が切れています。'}</p>
          <p className="small">ご家族に、もう一度招待を送ってもらってください。</p>
        </div>
      </main>
    );
  }

  if (info.viewer === 'other') {
    return (
      <main className="screen">
        {header}
        <h2>{info.householdName}とまとめますか?</h2>
        <p className="small">
          このLINEは、すでに別のおうちで会員証を使っています。2つのおうちのポイントは、受付でワンちゃんの写真を確認してから1つにまとめます。
        </p>
        {error ? <ErrorNotice error={error} /> : null}
        <button type="button" className="btn" disabled={busy} onClick={accept}>
          {busy ? '申請しています…' : 'おうちをまとめる申請をする'}
        </button>
        <Link to="/" className="btn sub as-link" onClick={onJoined}>
          やめる
        </Link>
      </main>
    );
  }

  return (
    <main className="screen">
      {header}
      <h2>{info.householdName}に参加しますか?</h2>
      <p className="small">参加すると、ご家族と同じ会員証でポイントがたまります。ワンちゃんの登録は要りません。</p>
      {info.questions.length > 0 && (
        <>
          <b className="small">あなたについて教えてください</b>
          <SurveyForm questions={info.questions} values={values} onChange={setValues} />
        </>
      )}
      {info.terms && (
        <div className="panel">
          <p className="small">
            LINEの表示名とアンケートの回答、来場の記録をお預かりし、会員証とポイントの管理、ドッグランをよくするための集計に使います。
          </p>
          <details>
            <summary>利用規約を読む</summary>
            <p className="terms">{info.terms.termsText}</p>
          </details>
          <details>
            <summary>プライバシーポリシーを読む</summary>
            <p className="terms">{info.terms.privacyText}</p>
          </details>
        </div>
      )}
      <label className="check">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>利用規約とプライバシーポリシーに同意します</span>
      </label>
      {message && (
        <div className="notice bad" role="alert">
          <p>{message}</p>
        </div>
      )}
      {error ? <ErrorNotice error={error} /> : null}
      <button type="button" className="btn" disabled={busy} onClick={accept}>
        {busy ? '参加しています…' : '参加する'}
      </button>
    </main>
  );
}
