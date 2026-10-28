import type { MeUnregistered } from '@dr/shared';
import { useState } from 'react';
import { ErrorNotice } from '../../components/ErrorNotice';

/** L-01 同意・はじめての方へ(C-01) */
export function ConsentStep({ me, onSubmit }: { me: MeUnregistered; onSubmit: () => Promise<void> }) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const next = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="screen">
      <h2>はじめての方へ</h2>
      <p>
        {me.lineDisplayName ? `${me.lineDisplayName}さん、` : ''}
        ようこそ。このLINEで、ドッグランの会員証(ポイントカード)が使えるようになります。
      </p>
      <div className="panel">
        <b>できること</b>
        <ul className="plain-list">
          <li>受付のQRコードを読み取るだけでチェックイン</li>
          <li>1日1ポイント。10ポイントで無料券1枚</li>
          <li>ご家族のLINEとポイントをいっしょにためられます</li>
        </ul>
      </div>
      <div className="panel">
        <b>お預かりする情報と使い道</b>
        <p className="small">
          LINEの表示名、ワンちゃんの写真と情報、アンケートの回答、来場の記録をお預かりします。会員証とポイントの管理、受付でのお客さまの確認、ドッグランをよくするための集計に使います。
        </p>
        <details>
          <summary>利用規約を読む</summary>
          <p className="terms">{me.terms.termsText}</p>
        </details>
        <details>
          <summary>プライバシーポリシーを読む</summary>
          <p className="terms">{me.terms.privacyText}</p>
        </details>
      </div>
      <label className="check">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>利用規約とプライバシーポリシーに同意します</span>
      </label>
      {error ? <ErrorNotice error={error} /> : null}
      <button type="button" className="btn" disabled={!agreed || busy} onClick={next}>
        {busy ? '登録しています…' : '同意して次へ'}
      </button>
    </main>
  );
}
